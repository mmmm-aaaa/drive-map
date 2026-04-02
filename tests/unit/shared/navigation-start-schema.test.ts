import { describe, expect, it } from "vitest";
import { navigationStartRequestSchema } from "../../../backend/src/schema/navigation-start";

describe("navigationStartRequestSchema", () => {
  it("accepts valid request body", () => {
    const result = navigationStartRequestSchema.safeParse({
      origin: { lat: 35, lng: 139 },
      durationMinutes: 90,
      tollRoadsAllowed: true
    });

    expect(result.success).toBe(true);
  });

  it("accepts duration with hour-and-minute style totals", () => {
    const oneHourOne = navigationStartRequestSchema.safeParse({
      origin: { lat: 35, lng: 139 },
      durationMinutes: 61,
      tollRoadsAllowed: true
    });
    expect(oneHourOne.success).toBe(true);
  });

  it("rejects duration outside allowed range", () => {
    const tooShort = navigationStartRequestSchema.safeParse({
      origin: { lat: 35, lng: 139 },
      durationMinutes: 59,
      tollRoadsAllowed: true
    });
    const tooLong = navigationStartRequestSchema.safeParse({
      origin: { lat: 35, lng: 139 },
      durationMinutes: 1801,
      tollRoadsAllowed: true
    });

    expect(tooShort.success).toBe(false);
    expect(tooLong.success).toBe(false);
  });
});
