import { DURATION_TOLERANCE_MINUTES } from "@drive-map/shared";

type ValidateRouteDurationResult = {
  ok: boolean;
  diffMinutes: number;
  toleranceMinutes: number;
};

export function validateRouteDuration(routeDurationSeconds: number, requestedDurationMinutes: number): ValidateRouteDurationResult {
  const routeDurationMinutes = routeDurationSeconds / 60;
  const diffMinutes = Math.abs(routeDurationMinutes - requestedDurationMinutes);

  return {
    ok: diffMinutes <= DURATION_TOLERANCE_MINUTES,
    diffMinutes: Math.ceil(diffMinutes),
    toleranceMinutes: DURATION_TOLERANCE_MINUTES
  };
}
