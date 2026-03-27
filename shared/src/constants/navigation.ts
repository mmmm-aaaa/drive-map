export const MIN_DURATION_MINUTES = 30;
export const MAX_DURATION_MINUTES = 1800;
export const DURATION_TOLERANCE_MINUTES = 15;

export const LLM_CANDIDATE_LIMIT = 3;
export const LLM_RETRY_LIMIT = 2;
export const PLACE_RESULT_LIMIT = 3;

export const START_HARD_TIMEOUT_MS = 8_000;

export const START_RATE_LIMIT_PERIOD_SECONDS = 10;
export const START_RATE_LIMIT_MAX_REQUESTS = 1;

export const NAVIGATION_DISTANCE_THRESHOLDS_METERS = [800, 600, 400, 200, 100, 50] as const;
export const ARRIVAL_DISTANCE_METERS = 50;
export const OFF_ROUTE_BASE_DISTANCE_METERS = 60;
export const OFF_ROUTE_ACCURACY_MULTIPLIER = 1.5;
export const ON_ROUTE_BASE_DISTANCE_METERS = 30;

export const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 3_000
};
