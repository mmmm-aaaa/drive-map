import { describe, expect, it } from "vitest";
import { maskSensitiveValue } from "../../../backend/src/lib/logger";

describe("maskSensitiveValue", () => {
  it("masks location and route-related keys", () => {
    const masked = maskSensitiveValue({
      lat: 35.1,
      lng: 139.2,
      polyline: "abc",
      requestId: "r1",
      nested: {
        destination: "tokyo",
        note: "safe"
      }
    }) as Record<string, unknown>;

    expect(masked.lat).toBe("[REDACTED]");
    expect(masked.lng).toBe("[REDACTED]");
    expect(masked.polyline).toBe("[REDACTED]");
    expect(masked.requestId).toBe("r1");

    const nested = masked.nested as Record<string, unknown>;
    expect(nested.destination).toBe("[REDACTED]");
    expect(nested.note).toBe("safe");
  });
});
