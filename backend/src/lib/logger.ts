type LogLevel = "info" | "warn" | "error";

type LogPayload = {
  requestId: string;
  event: string;
  details?: Record<string, unknown>;
};

const SENSITIVE_KEY_PATTERNS = [/lat/i, /lng/i, /latitude/i, /longitude/i, /polyline/i, /candidate/i, /origin/i, /destination/i];

function shouldMaskKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function maskSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => maskSensitiveValue(entry));
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => {
      if (shouldMaskKey(key)) {
        return [key, "[REDACTED]"] as const;
      }
      return [key, maskSensitiveValue(nestedValue)] as const;
    });
    return Object.fromEntries(entries);
  }

  return value;
}

export function createRequestId(): string {
  return crypto.randomUUID();
}

function writeLog(level: LogLevel, payload: LogPayload): void {
  const message = JSON.stringify({
    level,
    requestId: payload.requestId,
    event: payload.event,
    details: maskSensitiveValue(payload.details ?? {})
  });

  if (level === "error") {
    console.error(message);
    return;
  }

  if (level === "warn") {
    console.warn(message);
    return;
  }

  console.log(message);
}

export function logInfo(payload: LogPayload): void {
  writeLog("info", payload);
}

export function logError(payload: LogPayload): void {
  writeLog("error", payload);
}
