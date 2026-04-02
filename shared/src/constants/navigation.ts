export const MIN_DURATION_MINUTES = 60;
export const MAX_DURATION_MINUTES = 1800;
export const DURATION_TOLERANCE_MINUTES = 15;

export const PLACE_RESULT_LIMIT = 3;

export const START_HARD_TIMEOUT_MS = 180_000;

export const LLM_PER_CALL_TIMEOUT_MS = 30_000;
export const LLM_READ_TIMEOUT_MS = 30_000;
export const MIN_REMAINING_FOR_RETRY_MS = 15_000;
export const RETRY_SAFETY_MARGIN_MS = 5_000;

export const START_RATE_LIMIT_PERIOD_SECONDS = 10;
export const START_RATE_LIMIT_MAX_REQUESTS = 1;

export const NAVIGATION_DISTANCE_THRESHOLDS_METERS = [800, 600, 400, 200, 100, 50] as const;
export const DEFAULT_STEP_INSTRUCTION = "そのまま進んでください。";
export const OFF_ROUTE_INSTRUCTION = "元のルートに戻ってください。";
export const ARRIVAL_INSTRUCTION = "目的地付近に到着しました。安全な場所に停車してください。";
export const ARRIVAL_DISTANCE_METERS = 50;
export const OFF_ROUTE_BASE_DISTANCE_METERS = 60;
export const OFF_ROUTE_ACCURACY_MULTIPLIER = 1.5;
export const ON_ROUTE_BASE_DISTANCE_METERS = 30;

export const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10_000,
  maximumAge: 3_000
};
