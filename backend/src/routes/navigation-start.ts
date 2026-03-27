import { START_HARD_TIMEOUT_MS } from "@drive-map/shared";
import type { Context } from "hono";
import type { Hono } from "hono";
import type { StartNavigationResponse } from "@drive-map/shared";
import { handleStartNavigation } from "../handlers/start-navigation";
import { RequestAbortedError, combineAbortSignals, isAbortError } from "../lib/abort";
import { checkStartRateLimit } from "../lib/rate-limit";
import { jsonResponse } from "../lib/response";
import { navigationStartRequestSchema } from "../schema/navigation-start";

function buildValidationError(message: string, issues?: string[]): StartNavigationResponse {
  return {
    status: "validation_failed",
    message,
    ...(issues ? { issues } : {})
  };
}

function buildUpstreamError(message: string): StartNavigationResponse {
  return {
    status: "upstream_error",
    message
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

function getConfiguredOrigin(env: Env): string | null {
  const origin = env.APP_ORIGIN?.trim();
  return origin ? origin : null;
}

export function registerNavigationStartRoute(app: Hono<{ Bindings: Env; Variables: { requestId: string } }>): void {
  app.post("/api/navigation/start", async (c) => {
    const requestId = c.get("requestId");
    const contentType = c.req.header("content-type") ?? "";

    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse(c, 415, buildValidationError("application/json で送信してください。"));
    }

    const appOrigin = getConfiguredOrigin(c.env);
    if (!appOrigin) {
      return jsonResponse(c, 503, buildUpstreamError("サーバー設定が未完了です。公開設定を確認してください。"));
    }

    const requestOrigin = c.req.header("origin")?.trim();
    if (!requestOrigin) {
      return jsonResponse(c, 403, buildValidationError("Origin ヘッダが必要です。"));
    }

    if (requestOrigin !== appOrigin) {
      return jsonResponse(c, 403, buildValidationError("許可されていない Origin です。"));
    }

    const clientAddress = getClientAddress(c);
    const rateLimitResult = await checkStartRateLimit(c.env, clientAddress, requestId);
    if (!rateLimitResult.ok) {
      if (rateLimitResult.reason === "rate_limited") {
        return jsonResponse(c, 429, buildUpstreamError("リクエストが集中しています。10秒ほど待ってから再試行してください。"));
      }

      return jsonResponse(c, 503, buildUpstreamError("サーバー設定または保護機能が利用できません。時間をおいて再試行してください。"));
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

    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => {
      timeoutController.abort(new RequestAbortedError("Start navigation timed out"));
    }, START_HARD_TIMEOUT_MS);
    const { signal, cleanup } = combineAbortSignals([c.req.raw.signal, timeoutController.signal]);

    try {
      const result = await handleStartNavigation(parsed.data, c.env, signal);
      const statusCode = result.status === "ok" || result.status === "no_match" ? 200 : 502;
      return jsonResponse(c, statusCode, result);
    } catch (error) {
      if (timeoutController.signal.aborted && isAbortError(error)) {
        return jsonResponse(c, 504, buildUpstreamError("ナビ開始処理がタイムアウトしました。時間をおいて再試行してください。"));
      }

      if (c.req.raw.signal.aborted && isAbortError(error)) {
        return jsonResponse(c, 408, buildUpstreamError("リクエストが中断されました。"));
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
      cleanup();
    }
  });
}
