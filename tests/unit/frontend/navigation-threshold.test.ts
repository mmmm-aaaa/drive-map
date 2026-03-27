import { describe, expect, it } from "vitest";
import { toDistanceBucket } from "../../../frontend/src/lib/navigation-threshold";

describe("toDistanceBucket", () => {
  it("returns 800 bucket for 800m or more", () => {
    expect(toDistanceBucket(1200)).toBe(800);
    expect(toDistanceBucket(800)).toBe(800);
  });

  it("returns middle buckets with boundary awareness", () => {
    expect(toDistanceBucket(799)).toBe(600);
    expect(toDistanceBucket(650)).toBe(600);
    expect(toDistanceBucket(599)).toBe(400);
    expect(toDistanceBucket(399)).toBe(200);
    expect(toDistanceBucket(199)).toBe(100);
    expect(toDistanceBucket(99)).toBe(50);
    expect(toDistanceBucket(50)).toBe(50);
  });

  it("returns soon bucket for under 50m", () => {
    expect(toDistanceBucket(49.9)).toBe("soon");
    expect(toDistanceBucket(0)).toBe("soon");
  });
});
