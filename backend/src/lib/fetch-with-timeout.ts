import { RequestAbortedError, toRequestAbortedError } from "./abort";

export class FetchTimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
    this.name = "FetchTimeoutError";
  }
}

type FetchWithTimeoutOptions = {
  timeoutMs: number;
  retries: number;
  retryDelayMs: number;
  shouldRetryStatus?: (status: number) => boolean;
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
};

const DEFAULT_SHOULD_RETRY_STATUS = (status: number): boolean => status === 429 || status >= 500;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryError(error: unknown): boolean {
  if (error instanceof RequestAbortedError) {
    return false;
  }

  if (error instanceof FetchTimeoutError) {
    return true;
  }

  if (error instanceof Error) {
    return error.name === "AbortError" || error.name === "TypeError";
  }

  return false;
}

export async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit | undefined, options: FetchWithTimeoutOptions): Promise<Response> {
  const { timeoutMs, retries, retryDelayMs, fetchFn = fetch, shouldRetryStatus = DEFAULT_SHOULD_RETRY_STATUS, signal } = options;

  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) {
      throw toRequestAbortedError(signal.reason);
    }

    const controller = new AbortController();
    const onAbort = (): void => {
      controller.abort(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeoutId = setTimeout(() => controller.abort(new FetchTimeoutError()), timeoutMs);

    try {
      const response = await fetchFn(input, {
        ...init,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return response;
      }

      if (attempt < retries && shouldRetryStatus(response.status)) {
        await wait(retryDelayMs);
        continue;
      }

      return response;
    } catch (error) {
      if (signal?.aborted) {
        lastError = toRequestAbortedError(signal.reason);
      } else if (controller.signal.aborted && controller.signal.reason instanceof FetchTimeoutError) {
        lastError = controller.signal.reason;
      } else if (controller.signal.aborted) {
        lastError = new FetchTimeoutError();
      } else {
        lastError = error;
      }

      if (attempt < retries && shouldRetryError(lastError)) {
        await wait(retryDelayMs);
        continue;
      }

      throw lastError;
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unexpected fetch failure");
}
