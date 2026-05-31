type ValidateRouteDurationResult = {
  ok: boolean;
  diffMinutes: number;
  toleranceMinutes: number;
  direction: "shorter" | "longer" | "exact";
  actualDurationMinutes: number;
  minAllowedMinutes: number;
  maxAllowedMinutes: number;
};

/** 60〜180 分帯: max(15, 20%) 上限 30 */
const TOLERANCE_FLOOR_SHORT_MINUTES = 15;
const TOLERANCE_RATIO_SHORT = 0.2;
const TOLERANCE_CAP_SHORT_MINUTES = 30;

/** 181〜360 分帯: max(30, 25%) 上限 75 */
const TOLERANCE_FLOOR_MID_MINUTES = 30;
const TOLERANCE_RATIO_MID = 0.25;
const TOLERANCE_CAP_MID_MINUTES = 75;

/** 361〜1800 分帯: max(45, 30%) 上限 180 */
const TOLERANCE_FLOOR_LONG_MINUTES = 45;
const TOLERANCE_RATIO_LONG = 0.3;
const TOLERANCE_CAP_LONG_MINUTES = 180;

export function calculateDurationToleranceMinutes(requestedDurationMinutes: number): number {
  if (requestedDurationMinutes <= 180) {
    const relativeTolerance = Math.ceil(requestedDurationMinutes * TOLERANCE_RATIO_SHORT);
    return Math.min(TOLERANCE_CAP_SHORT_MINUTES, Math.max(TOLERANCE_FLOOR_SHORT_MINUTES, relativeTolerance));
  }

  if (requestedDurationMinutes <= 360) {
    const relativeTolerance = Math.ceil(requestedDurationMinutes * TOLERANCE_RATIO_MID);
    return Math.min(TOLERANCE_CAP_MID_MINUTES, Math.max(TOLERANCE_FLOOR_MID_MINUTES, relativeTolerance));
  }

  const relativeTolerance = Math.ceil(requestedDurationMinutes * TOLERANCE_RATIO_LONG);
  return Math.min(TOLERANCE_CAP_LONG_MINUTES, Math.max(TOLERANCE_FLOOR_LONG_MINUTES, relativeTolerance));
}

export function buildDurationWindowMinutes(requestedDurationMinutes: number): {
  toleranceMinutes: number;
  minAllowedMinutes: number;
  maxAllowedMinutes: number;
} {
  const toleranceMinutes = calculateDurationToleranceMinutes(requestedDurationMinutes);

  return {
    toleranceMinutes,
    minAllowedMinutes: Math.max(0, requestedDurationMinutes - toleranceMinutes),
    maxAllowedMinutes: requestedDurationMinutes + toleranceMinutes
  };
}

export function validateRouteDuration(routeDurationSeconds: number, requestedDurationMinutes: number): ValidateRouteDurationResult {
  const routeDurationMinutes = routeDurationSeconds / 60;
  const actualDurationMinutes = Math.max(0, Math.round(routeDurationMinutes));
  const rawDeltaMinutes = routeDurationMinutes - requestedDurationMinutes;
  const diffMinutes = Math.abs(rawDeltaMinutes);
  const { toleranceMinutes, minAllowedMinutes, maxAllowedMinutes } = buildDurationWindowMinutes(requestedDurationMinutes);

  return {
    ok: diffMinutes <= toleranceMinutes,
    diffMinutes: Math.ceil(diffMinutes),
    toleranceMinutes,
    direction: rawDeltaMinutes === 0 ? "exact" : rawDeltaMinutes > 0 ? "longer" : "shorter",
    actualDurationMinutes,
    minAllowedMinutes,
    maxAllowedMinutes
  };
}
