import { DURATION_TOLERANCE_MINUTES } from "@drive-map/shared";

type ValidateRouteDurationResult = {
  ok: boolean;
  diffMinutes: number;
  toleranceMinutes: number;
  direction: "shorter" | "longer" | "exact";
  actualDurationMinutes: number;
  minAllowedMinutes: number;
  maxAllowedMinutes: number;
};

const RELATIVE_DURATION_TOLERANCE_RATIO = 0.2;
const MAX_DURATION_TOLERANCE_MINUTES = 30;

export function calculateDurationToleranceMinutes(requestedDurationMinutes: number): number {
  const relativeTolerance = Math.ceil(requestedDurationMinutes * RELATIVE_DURATION_TOLERANCE_RATIO);
  return Math.min(MAX_DURATION_TOLERANCE_MINUTES, Math.max(DURATION_TOLERANCE_MINUTES, relativeTolerance));
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
