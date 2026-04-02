import { describe, expect, it } from "vitest";
import {
  estimateAverageDrivingSpeedKmh,
  estimatePlaceBiasRadiusMeters,
  estimateReachableDistanceKm
} from "../../../backend/src/domain/drive-estimate";

describe("drive estimate helpers", () => {
  it("uses different average speeds for toll and non-toll routes", () => {
    expect(estimateAverageDrivingSpeedKmh(true)).toBe(80);
    expect(estimateAverageDrivingSpeedKmh(false)).toBe(40);
  });

  it("keeps reachable distance above the minimum floor", () => {
    expect(estimateReachableDistanceKm(5, false)).toBe(10);
  });

  it("estimates reachable distance from requested duration", () => {
    expect(estimateReachableDistanceKm(90, true)).toBe(120);
    expect(estimateReachableDistanceKm(90, false)).toBe(60);
  });

  it("caps place bias radius inside the allowed range", () => {
    expect(estimatePlaceBiasRadiusMeters(5, false)).toBe(5_000);
    expect(estimatePlaceBiasRadiusMeters(1_800, true)).toBe(50_000);
  });
});
