import { describe, expect, it } from "vitest";
import {
  buildDriveEstimateContext,
  estimatePlaceBiasRadiusMeters,
  estimateReachableDistanceKm,
  resolveDriveRegionProfile,
  resolveDurationBand
} from "../../../backend/src/domain/drive-estimate";

const tokyoStation = { lat: 35.681236, lng: 139.767125 };
const hachioji = { lat: 35.655, lng: 139.323 };
const osakaStation = { lat: 34.702485, lng: 135.495951 };
const nagoyaStation = { lat: 35.170915, lng: 136.881537 };
const fukuokaCenter = { lat: 33.590355, lng: 130.401716 };
const matsumoto = { lat: 36.238038, lng: 137.971989 };

/** kansai_core と chukyo_core の間のすきま（どちらにも入らない） */
const betweenKansaiChukyo = { lat: 34.9, lng: 136.5 };

describe("resolveDriveRegionProfile", () => {
  it("classifies known fixture coordinates into expected regions", () => {
    expect(resolveDriveRegionProfile(tokyoStation)).toBe("tokyo_core");
    expect(resolveDriveRegionProfile(hachioji)).toBe("tokyo_outer");
    expect(resolveDriveRegionProfile(osakaStation)).toBe("kansai_core");
    expect(resolveDriveRegionProfile(nagoyaStation)).toBe("chukyo_core");
    expect(resolveDriveRegionProfile(fukuokaCenter)).toBe("regional_city");
    expect(resolveDriveRegionProfile(matsumoto)).toBe("rural_default");
  });

  it("returns rural_default for coordinates outside all bboxes", () => {
    expect(resolveDriveRegionProfile({ lat: 43.5, lng: 142.5 })).toBe("rural_default");
  });

  it("does not classify the kansai/chukyo gap into either core", () => {
    expect(resolveDriveRegionProfile(betweenKansaiChukyo)).toBe("rural_default");
  });

  it("prefers tokyo_core over tokyo_outer when both bboxes would apply", () => {
    expect(resolveDriveRegionProfile(tokyoStation)).toBe("tokyo_core");
  });
});

describe("estimateReachableDistanceKm", () => {
  it("gives a longer estimate for rural_default than tokyo_core at the same short duration", () => {
    const urban = estimateReachableDistanceKm(tokyoStation, 60, true);
    const rural = estimateReachableDistanceKm(matsumoto, 60, true);
    expect(rural).toBeGreaterThan(urban);
  });

  it("differs between toll and non-toll in the same region", () => {
    const toll = estimateReachableDistanceKm(matsumoto, 120, true);
    const nonToll = estimateReachableDistanceKm(matsumoto, 120, false);
    expect(toll).toBeGreaterThan(nonToll);
  });

  it("reduces regional spread at 10 hours vs 1 hour (tokyo vs rural ratio shrinks)", () => {
    const ratio1h =
      estimateReachableDistanceKm(matsumoto, 60, true) / estimateReachableDistanceKm(tokyoStation, 60, true);
    const ratio10h =
      estimateReachableDistanceKm(matsumoto, 600, true) / estimateReachableDistanceKm(tokyoStation, 600, true);
    expect(ratio10h).toBeLessThan(ratio1h);
  });

  it("enforces a minimum reachable distance floor", () => {
    expect(estimateReachableDistanceKm(tokyoStation, 5, false)).toBe(10);
  });
});

describe("estimatePlaceBiasRadiusMeters", () => {
  it("stays within Places API bias limits", () => {
    expect(estimatePlaceBiasRadiusMeters(tokyoStation, 5, false)).toBe(5_000);
    expect(estimatePlaceBiasRadiusMeters(matsumoto, 1_800, true)).toBe(50_000);
  });
});

describe("resolveDurationBand", () => {
  it("maps duration steps to bands", () => {
    expect(resolveDurationBand(60)).toBe("short");
    expect(resolveDurationBand(180)).toBe("short");
    expect(resolveDurationBand(181)).toBe("mid");
    expect(resolveDurationBand(360)).toBe("mid");
    expect(resolveDurationBand(361)).toBe("long");
  });
});

describe("buildDriveEstimateContext", () => {
  it("includes Japanese region label and rounded km", () => {
    const ctx = buildDriveEstimateContext(tokyoStation, 90, true);
    expect(ctx.regionProfile).toBe("tokyo_core");
    expect(ctx.regionLabelJa).toBe("東京都心部");
    expect(ctx.estimatedDistanceKm).toBe(70);
    expect(ctx.durationBand).toBe("short");
  });
});

describe("kansai vs chukyo boundary", () => {
  it("keeps kansai_core west of the intentional lng gap", () => {
    expect(resolveDriveRegionProfile({ lat: 34.7, lng: 136.0 })).toBe("kansai_core");
  });

  it("keeps chukyo_core east of the gap", () => {
    expect(resolveDriveRegionProfile({ lat: 35.0, lng: 136.8 })).toBe("chukyo_core");
  });

  it("does not classify lng 136.45 or 136.55 into either core (half-open intervals)", () => {
    const latOverlap = 34.9;
    expect(resolveDriveRegionProfile({ lat: latOverlap, lng: 136.45 })).toBe("rural_default");
    expect(resolveDriveRegionProfile({ lat: latOverlap, lng: 136.55 })).toBe("rural_default");
  });
});
