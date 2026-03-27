import { describe, expect, it } from "vitest";
import { isValidLatLng } from "../../../shared/src/domain/location";

describe("isValidLatLng", () => {
  it("accepts valid lat/lng range", () => {
    expect(isValidLatLng({ lat: 35.0, lng: 139.0 })).toBe(true);
  });

  it("rejects invalid lat/lng values", () => {
    expect(isValidLatLng({ lat: 91, lng: 139.0 })).toBe(false);
    expect(isValidLatLng({ lat: 35.0, lng: -181 })).toBe(false);
    expect(isValidLatLng({ lat: Number.NaN, lng: 139.0 })).toBe(false);
  });
});
