import { describe, expect, it } from "vitest";
import { validateRouteDuration } from "../../../backend/src/domain/validate-route-duration";

describe("validateRouteDuration", () => {
  it("accepts routes within the tolerance window", () => {
    const result = validateRouteDuration(105 * 60, 90);

    expect(result).toEqual({
      ok: true,
      diffMinutes: 15,
      toleranceMinutes: 15
    });
  });

  it("rounds rejected differences upward so the message does not under-report the gap", () => {
    const result = validateRouteDuration(Math.round(105.1 * 60), 90);

    expect(result).toEqual({
      ok: false,
      diffMinutes: 16,
      toleranceMinutes: 15
    });
  });
});
