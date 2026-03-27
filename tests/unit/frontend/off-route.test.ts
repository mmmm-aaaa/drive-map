import { describe, expect, it } from "vitest";
import { nextOffRouteConsecutiveCount, offRouteThresholdMeters, onRouteThresholdMeters } from "../../../frontend/src/lib/off-route";

describe("off-route helpers", () => {
  it("calculates off-route threshold with accuracy hysteresis", () => {
    expect(offRouteThresholdMeters(10)).toBe(60);
    expect(offRouteThresholdMeters(50)).toBe(75);
  });

  it("calculates on-route recovery threshold", () => {
    expect(onRouteThresholdMeters(10)).toBe(30);
    expect(onRouteThresholdMeters(40)).toBe(40);
  });

  it("increments and resets off-route consecutive count", () => {
    expect(nextOffRouteConsecutiveCount(80, 10, 0)).toBe(1);
    expect(nextOffRouteConsecutiveCount(90, 10, 1)).toBe(2);
    expect(nextOffRouteConsecutiveCount(10, 10, 2)).toBe(0);
  });
});
