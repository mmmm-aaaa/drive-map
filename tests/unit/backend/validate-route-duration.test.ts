import { describe, expect, it } from "vitest";
import { validateRouteDuration } from "../../../backend/src/domain/validate-route-duration";

describe("validateRouteDuration", () => {
  it("accepts routes within the tolerance window", () => {
    const result = validateRouteDuration(105 * 60, 90);

    expect(result).toEqual({
      ok: true,
      diffMinutes: 15,
      toleranceMinutes: 18,
      direction: "longer",
      actualDurationMinutes: 105,
      minAllowedMinutes: 72,
      maxAllowedMinutes: 108
    });
  });

  it("rounds rejected differences upward so the message does not under-report the gap", () => {
    const result = validateRouteDuration(Math.round(108.1 * 60), 90);

    expect(result).toEqual({
      ok: false,
      diffMinutes: 19,
      toleranceMinutes: 18,
      direction: "longer",
      actualDurationMinutes: 108,
      minAllowedMinutes: 72,
      maxAllowedMinutes: 108
    });
  });

  it("allows a wider absolute tolerance for longer requested durations", () => {
    const result = validateRouteDuration(207 * 60, 180);

    expect(result).toEqual({
      ok: true,
      diffMinutes: 27,
      toleranceMinutes: 30,
      direction: "longer",
      actualDurationMinutes: 207,
      minAllowedMinutes: 150,
      maxAllowedMinutes: 210
    });
  });

  it("reports when the route is shorter than requested", () => {
    const result = validateRouteDuration(60 * 60, 90);

    expect(result).toEqual({
      ok: false,
      diffMinutes: 30,
      toleranceMinutes: 18,
      direction: "shorter",
      actualDurationMinutes: 60,
      minAllowedMinutes: 72,
      maxAllowedMinutes: 108
    });
  });
});
