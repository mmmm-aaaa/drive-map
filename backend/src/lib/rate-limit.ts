import { logError } from "./logger";

export type StartRateLimitCheckResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      reason: "rate_limited" | "unavailable";
    };

function isTruthy(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export async function checkStartRateLimit(env: Env, key: string, requestId: string): Promise<StartRateLimitCheckResult> {
  const limiter = env.START_RATE_LIMIT;

  if (!limiter) {
    if (isTruthy(env.ALLOW_UNPROTECTED_START)) {
      return { ok: true };
    }

    logError({
      requestId,
      event: "start_rate_limit_unavailable",
      details: {
        message: "START_RATE_LIMIT binding is required unless ALLOW_UNPROTECTED_START=true"
      }
    });
    return {
      ok: false,
      reason: "unavailable"
    };
  }

  try {
    const result = await limiter.limit({ key });
    return result.success
      ? { ok: true }
      : {
          ok: false,
          reason: "rate_limited"
        };
  } catch (error) {
    logError({
      requestId,
      event: "rate_limit_check_failed",
      details: {
        message: error instanceof Error ? error.message : "unknown"
      }
    });
    return {
      ok: false,
      reason: "unavailable"
    };
  }
}
