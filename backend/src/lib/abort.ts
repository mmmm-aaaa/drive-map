export class RequestAbortedError extends Error {
  constructor(message = "Request aborted") {
    super(message);
    this.name = "RequestAbortedError";
  }
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof RequestAbortedError) {
    return true;
  }

  return error instanceof Error && error.name === "AbortError";
}

export function toRequestAbortedError(reason: unknown, fallbackMessage = "Request aborted"): RequestAbortedError {
  if (reason instanceof RequestAbortedError) {
    return reason;
  }

  if (reason instanceof Error) {
    return new RequestAbortedError(reason.message);
  }

  if (typeof reason === "string" && reason.trim().length > 0) {
    return new RequestAbortedError(reason);
  }

  return new RequestAbortedError(fallbackMessage);
}

export function combineAbortSignals(signals: AbortSignal[]): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const listeners: Array<() => void> = [];

  const cleanup = (): void => {
    while (listeners.length > 0) {
      const removeListener = listeners.pop();
      removeListener?.();
    }
  };

  const abortFrom = (source: AbortSignal): void => {
    if (!controller.signal.aborted) {
      controller.abort(toRequestAbortedError(source.reason));
    }
    cleanup();
  };

  for (const source of signals) {
    if (source.aborted) {
      abortFrom(source);
      return { signal: controller.signal, cleanup };
    }

    const onAbort = (): void => {
      abortFrom(source);
    };

    source.addEventListener("abort", onAbort, { once: true });
    listeners.push(() => {
      source.removeEventListener("abort", onAbort);
    });
  }

  return { signal: controller.signal, cleanup };
}
