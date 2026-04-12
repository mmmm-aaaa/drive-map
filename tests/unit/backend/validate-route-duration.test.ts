import { describe, expect, it } from "vitest";
import {
  buildDurationWindowMinutes,
  calculateDurationToleranceMinutes,
  validateRouteDuration
} from "../../../backend/src/domain/validate-route-duration";

describe("calculateDurationToleranceMinutes", () => {
  it("uses the short band for 60–180 minutes with a 30 minute cap", () => {
    expect(calculateDurationToleranceMinutes(90)).toBe(18);
    expect(calculateDurationToleranceMinutes(180)).toBe(30);
  });

  it("widens tolerance at the 181 minute boundary", () => {
    expect(calculateDurationToleranceMinutes(180)).toBe(30);
    expect(calculateDurationToleranceMinutes(181)).toBe(46);
  });

  it("uses the mid band for 181–360 minutes with a 75 minute cap", () => {
    expect(calculateDurationToleranceMinutes(240)).toBe(60);
    expect(calculateDurationToleranceMinutes(360)).toBe(75);
  });

  it("uses the long band for 361+ minutes with a 180 minute cap", () => {
    expect(calculateDurationToleranceMinutes(361)).toBe(109);
    expect(calculateDurationToleranceMinutes(600)).toBe(180);
  });
});

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

  it("allows a wider absolute tolerance for 180 minute requests", () => {
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

  it("applies mid-band tolerance for a 240 minute request", () => {
    const w = buildDurationWindowMinutes(240);
    expect(w.toleranceMinutes).toBe(60);
    expect(w.minAllowedMinutes).toBe(180);
    expect(w.maxAllowedMinutes).toBe(300);

    const result = validateRouteDuration(340 * 60, 240);
    expect(result.ok).toBe(false);
    expect(result.toleranceMinutes).toBe(60);
    expect(result.diffMinutes).toBe(100);
  });

  it("applies long-band tolerance for a 600 minute request", () => {
    const w = buildDurationWindowMinutes(600);
    expect(w.toleranceMinutes).toBe(180);
    const result = validateRouteDuration(780 * 60, 600);
    expect(result.ok).toBe(true);
    expect(result.diffMinutes).toBe(180);
  });
});
