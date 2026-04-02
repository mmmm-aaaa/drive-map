const TOLL_ROAD_SPEED_KMH = 80;
const NON_TOLL_ROAD_SPEED_KMH = 40;
const MIN_REACHABLE_DISTANCE_KM = 10;
const MIN_PLACE_BIAS_RADIUS_METERS = 5_000;
const MAX_PLACE_BIAS_RADIUS_METERS = 50_000;
const PLACE_BIAS_RADIUS_MARGIN = 1.2;

export function estimateAverageDrivingSpeedKmh(tollRoadsAllowed: boolean): number {
  return tollRoadsAllowed ? TOLL_ROAD_SPEED_KMH : NON_TOLL_ROAD_SPEED_KMH;
}

export function estimateReachableDistanceKm(durationMinutes: number, tollRoadsAllowed: boolean): number {
  const averageKmh = estimateAverageDrivingSpeedKmh(tollRoadsAllowed);
  return Math.max(MIN_REACHABLE_DISTANCE_KM, Math.round((averageKmh * durationMinutes) / 60));
}

export function estimatePlaceBiasRadiusMeters(durationMinutes: number, tollRoadsAllowed: boolean): number {
  const averageKmh = estimateAverageDrivingSpeedKmh(tollRoadsAllowed);
  const estimatedMeters = (averageKmh * 1_000 * durationMinutes) / 60;
  return Math.round(Math.max(MIN_PLACE_BIAS_RADIUS_METERS, Math.min(MAX_PLACE_BIAS_RADIUS_METERS, estimatedMeters * PLACE_BIAS_RADIUS_MARGIN)));
}
