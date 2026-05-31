import { START_HARD_TIMEOUT_MS } from "@drive-map/shared";
import type { Context } from "hono";
import type { Hono } from "hono";
import type { StartNavigationResponse } from "@drive-map/shared";
import type { AppBindings } from "../app";
import { handleStartNavigation } from "../handlers/start-navigation";
import { parseEnv } from "../env";
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
  const raw = env.APP_ORIGIN?.trim();
  if (!raw) {
    return null;
  }

  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

type StartNavigationOutcome =
  | { type: "success"; result: StartNavigationResponse }
  | { type: "error"; error: unknown }
  | { type: "timeout" };

export function registerNavigationStartRoute(app: Hono<AppBindings>): void {
  app.post("/api/navigation/start", async (c) => {
    const requestId = c.get("requestId");
    const contentType = c.req.header("content-type") ?? "";

    if (!contentType.toLowerCase().includes("application/json")) {
      return jsonResponse(c, 415, buildValidationError("application/json で送信してください。"));
    }

    const parsedEnv = (() => {
      try {
        return parseEnv(c.env);
      } catch {
        return null;
      }
    })();
    if (!parsedEnv) {
      return jsonResponse(c, 503, buildUpstreamError("サーバー設定が未完了です。環境変数を確認してください。"));
    }

    const appOrigin = getConfiguredOrigin(parsedEnv);
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
    const rateLimitResult = await checkStartRateLimit(parsedEnv, clientAddress, requestId);
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
    const { signal, cleanup } = combineAbortSignals([c.req.raw.signal, timeoutController.signal]);
    const navigationPromise: Promise<StartNavigationOutcome> = handleStartNavigation(parsed.data, parsedEnv, signal, requestId)
      .then((result): StartNavigationOutcome => ({
        type: "success",
        result
      }))
      .catch((error: unknown): StartNavigationOutcome => ({
        type: "error",
        error
      }));

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise: Promise<StartNavigationOutcome> = new Promise((resolve) => {
      timeoutId = setTimeout(() => {
        timeoutController.abort(new RequestAbortedError("Start navigation timed out"));
        resolve({ type: "timeout" });
      }, START_HARD_TIMEOUT_MS);
    });

    try {
      const outcome = await Promise.race([navigationPromise, timeoutPromise]);

      if (outcome.type === "timeout") {
        return jsonResponse(c, 504, buildUpstreamError("ナビ開始処理がタイムアウトしました。時間をおいて再試行してください。"));
      }

      if (outcome.type === "error") {
        const { error } = outcome;

        if (timeoutController.signal.aborted && isAbortError(error)) {
          return jsonResponse(c, 504, buildUpstreamError("ナビ開始処理がタイムアウトしました。時間をおいて再試行してください。"));
        }

        if (c.req.raw.signal.aborted && isAbortError(error)) {
          return jsonResponse(c, 408, buildUpstreamError("リクエストが中断されました。"));
        }

        throw error;
      }

      const statusCode = outcome.result.status === "ok" || outcome.result.status === "no_match" ? 200 : 502;
      return jsonResponse(c, statusCode, outcome.result);
    } catch (error) {
      if (c.req.raw.signal.aborted && isAbortError(error)) {
        return jsonResponse(c, 408, buildUpstreamError("リクエストが中断されました。"));
      }

      throw error;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      cleanup();
    }
  });
}
