import { logError } from "./logger";

export async function checkStartRateLimit(env: Env, key: string, requestId: string): Promise<boolean> {
  const limiter = env.START_RATE_LIMIT;

  if (!limiter) {
    return true;
  }

  try {
    const result = await limiter.limit({ key });
    return result.success;
  } catch (error) {
    logError({
      requestId,
      event: "rate_limit_check_failed",
      details: {
        message: error instanceof Error ? error.message : "unknown"
      }
    });
    return false;
  }
}
