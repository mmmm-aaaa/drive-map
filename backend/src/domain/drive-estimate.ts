import type { LatLng } from "@drive-map/shared";

/** 出発座標に基づく粗い地域区分（広域 bbox 判定） */
export type DriveRegionProfile =
  | "tokyo_core"
  | "tokyo_outer"
  | "chukyo_core"
  | "kansai_core"
  | "regional_city"
  | "rural_default";

export const DRIVE_REGION_LABEL_JA: Record<DriveRegionProfile, string> = {
  tokyo_core: "東京都心部",
  tokyo_outer: "首都圏郊外",
  chukyo_core: "中京圏（名古屋周辺）",
  kansai_core: "近畿圏（大阪・京都周辺）",
  regional_city: "地方中枢都市圏",
  rural_default: "その他・地方域"
};

const MIN_REACHABLE_DISTANCE_KM = 10;
const MIN_PLACE_BIAS_RADIUS_METERS = 5_000;
const MAX_PLACE_BIAS_RADIUS_METERS = 50_000;
const PLACE_BIAS_RADIUS_MARGIN = 1.2;

/** 短時間帯（最初の 60 分）に使う地域別速度 km/h */
const REGIONAL_SPEED_KMH: Record<DriveRegionProfile, { toll: number; nonToll: number }> = {
  tokyo_core: { toll: 35, nonToll: 20 },
  tokyo_outer: { toll: 45, nonToll: 30 },
  kansai_core: { toll: 45, nonToll: 25 },
  chukyo_core: { toll: 50, nonToll: 30 },
  regional_city: { toll: 55, nonToll: 35 },
  rural_default: { toll: 60, nonToll: 40 }
};

const NATIONAL_MID_SPEED_KMH = { toll: 70, nonToll: 45 };
const NATIONAL_LONG_SPEED_KMH = { toll: 75, nonToll: 50 };

function inBBox(lat: number, lng: number, latMin: number, latMax: number, lngMin: number, lngMax: number): boolean {
  return lat >= latMin && lat <= latMax && lng >= lngMin && lng <= lngMax;
}

/** 中京コア: lng は 136.55 より東のみ（136.45–136.55 のすきまおよび 136.55 端点は含めない） */
function inChukyoCoreBbox(lat: number, lng: number): boolean {
  return lat >= 34.75 && lat <= 35.45 && lng > 136.55 && lng <= 137.45;
}

/** 近畿コア: lng は 136.45 より西のみ（すきまおよび 136.45 端点は含めない） */
function inKansaiCoreBbox(lat: number, lng: number): boolean {
  return lat >= 34.45 && lat <= 35.2 && lng >= 134.9 && lng < 136.45;
}

/**
 * 判定優先順: tokyo_core → tokyo_outer → chukyo_core → kansai_core → regional_city → rural_default
 * kansai_core と chukyo_core の間は lng 136.45–136.55 をどちらにも含めない（端点 136.45 / 136.55 も両コア外）。
 */
export function resolveDriveRegionProfile(origin: LatLng): DriveRegionProfile {
  const { lat, lng } = origin;

  if (inBBox(lat, lng, 35.55, 35.82, 139.5, 139.95)) {
    return "tokyo_core";
  }

  if (inBBox(lat, lng, 35.2, 36.35, 138.85, 140.4)) {
    return "tokyo_outer";
  }

  if (inChukyoCoreBbox(lat, lng)) {
    return "chukyo_core";
  }

  if (inKansaiCoreBbox(lat, lng)) {
    return "kansai_core";
  }

  if (
    inBBox(lat, lng, 42.95, 43.2, 141.2, 141.5) ||
    inBBox(lat, lng, 38.15, 38.35, 140.75, 141.05) ||
    inBBox(lat, lng, 34.25, 34.55, 132.3, 132.6) ||
    inBBox(lat, lng, 33.45, 33.75, 130.2, 130.6)
  ) {
    return "regional_city";
  }

  return "rural_default";
}

/** 希望時間の段階（許容幅・説明用） */
export type DurationBand = "short" | "mid" | "long";

export function resolveDurationBand(durationMinutes: number): DurationBand {
  if (durationMinutes <= 180) {
    return "short";
  }
  if (durationMinutes <= 360) {
    return "mid";
  }
  return "long";
}

function regionalSpeedKmh(profile: DriveRegionProfile, tollRoadsAllowed: boolean): number {
  const row = REGIONAL_SPEED_KMH[profile];
  return tollRoadsAllowed ? row.toll : row.nonToll;
}

function nationalMidSpeedKmh(tollRoadsAllowed: boolean): number {
  return tollRoadsAllowed ? NATIONAL_MID_SPEED_KMH.toll : NATIONAL_MID_SPEED_KMH.nonToll;
}

function nationalLongSpeedKmh(tollRoadsAllowed: boolean): number {
  return tollRoadsAllowed ? NATIONAL_LONG_SPEED_KMH.toll : NATIONAL_LONG_SPEED_KMH.nonToll;
}

/** 段階式で積み上げた到達可能直線距離（km、未丸め） */
function computeReachableDistanceKmRaw(origin: LatLng, durationMinutes: number, tollRoadsAllowed: boolean): number {
  const profile = resolveDriveRegionProfile(origin);
  const regional = regionalSpeedKmh(profile, tollRoadsAllowed);
  const mid = nationalMidSpeedKmh(tollRoadsAllowed);
  const long = nationalLongSpeedKmh(tollRoadsAllowed);

  const m1 = Math.min(Math.max(0, durationMinutes), 60);
  const m2 = durationMinutes > 60 ? Math.min(durationMinutes - 60, 120) : 0;
  const m3 = durationMinutes > 180 ? durationMinutes - 180 : 0;

  return (regional * m1 + mid * m2 + long * m3) / 60;
}

export type DriveEstimateContext = {
  origin: LatLng;
  durationMinutes: number;
  tollRoadsAllowed: boolean;
  regionProfile: DriveRegionProfile;
  regionLabelJa: string;
  estimatedDistanceKm: number;
  durationBand: DurationBand;
};

export function buildDriveEstimateContext(
  origin: LatLng,
  durationMinutes: number,
  tollRoadsAllowed: boolean
): DriveEstimateContext {
  const regionProfile = resolveDriveRegionProfile(origin);
  return {
    origin,
    durationMinutes,
    tollRoadsAllowed,
    regionProfile,
    regionLabelJa: DRIVE_REGION_LABEL_JA[regionProfile],
    estimatedDistanceKm: estimateReachableDistanceKm(origin, durationMinutes, tollRoadsAllowed),
    durationBand: resolveDurationBand(durationMinutes)
  };
}

export function estimateReachableDistanceKm(origin: LatLng, durationMinutes: number, tollRoadsAllowed: boolean): number {
  const raw = computeReachableDistanceKmRaw(origin, durationMinutes, tollRoadsAllowed);
  return Math.max(MIN_REACHABLE_DISTANCE_KM, Math.round(raw));
}

export function estimatePlaceBiasRadiusMeters(
  origin: LatLng,
  durationMinutes: number,
  tollRoadsAllowed: boolean
): number {
  const rawKm = computeReachableDistanceKmRaw(origin, durationMinutes, tollRoadsAllowed);
  const estimatedMeters = rawKm * 1_000 * PLACE_BIAS_RADIUS_MARGIN;
  return Math.round(
    Math.max(MIN_PLACE_BIAS_RADIUS_METERS, Math.min(MAX_PLACE_BIAS_RADIUS_METERS, estimatedMeters))
  );
}
