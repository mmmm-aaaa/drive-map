import { START_HARD_TIMEOUT_MS } from "@drive-map/shared";
import type { Context } from "hono";
import type { Hono } from "hono";
import type { StartNavigationResponse } from "@drive-map/shared";
import { handleStartNavigation } from "../handlers/start-navigation";
import { checkStartRateLimit } from "../lib/rate-limit";
import { jsonResponse } from "../lib/response";
import { navigationStartRequestSchema } from "../schema/navigation-start";

type TimeoutMarker = {
  type: "timeout";
};

const timeoutMarker: TimeoutMarker = { type: "timeout" };

function buildValidationError(message: string, issues?: string[]): StartNavigationResponse {
  return {
    status: "validation_failed",
    message,
    ...(issues ? { issues } : {})
  };
}

function getClientAddress(c: Context): string {
  const cfConnectingIp = c.req.header("cf-connecting-ip");
  if (cfConnectingIp) {
    return cfConnectingIp;
  }

  const forwardedFor = c.req.header("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return "unknown";
}

export function registerNavigationStartRoute(app: Hono<{ Bindings: Env; Variables: { requestId: string } }>): void {
  app.post("/api/navigation/start", async (c) => {
    const requestId = c.get("requestId");
    const contentType = c.req.header("content-type") ?? "";

    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse(c, 415, buildValidationError("application/json で送信してください。"));
    }

    const appOrigin = c.env.APP_ORIGIN?.trim();
    const requestOrigin = c.req.header("origin");
    if (appOrigin && requestOrigin && requestOrigin !== appOrigin) {
      return jsonResponse(c, 403, buildValidationError("許可されていない Origin です。"));
    }

    const clientAddress = getClientAddress(c);
    const rateLimitOk = await checkStartRateLimit(c.env, clientAddress, requestId);
    if (!rateLimitOk) {
      const response: StartNavigationResponse = {
        status: "upstream_error",
        message: "リクエストが集中しています。10秒ほど待ってから再試行してください。"
      };
      return jsonResponse(c, 429, response);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return jsonResponse(c, 400, buildValidationError("JSON の形式が不正です。"));
    }

    const parsed = navigationStartRequestSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      return jsonResponse(c, 400, buildValidationError("入力値を確認してください。", issues));
    }

    const result = await Promise.race([handleStartNavigation(parsed.data, c.env), timeout(START_HARD_TIMEOUT_MS).then(() => timeoutMarker)]);

    if (isTimeoutMarker(result)) {
      const timeoutResponse: StartNavigationResponse = {
        status: "upstream_error",
        message: "ナビ開始処理がタイムアウトしました。時間をおいて再試行してください。"
      };
      return jsonResponse(c, 504, timeoutResponse);
    }

    const statusCode = result.status === "ok" || result.status === "no_match" ? 200 : 502;
    return jsonResponse(c, statusCode, result);
  });
}

function timeout(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isTimeoutMarker(value: StartNavigationResponse | TimeoutMarker): value is TimeoutMarker {
  return (value as TimeoutMarker).type === "timeout";
}
