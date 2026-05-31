import type { DistanceAnnouncementBucket, RouteStep } from "@drive-map/shared";

export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return "--";
  }

  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)}km`;
  }

  return `${Math.round(meters)}m`;
}

export function bucketLabel(bucket: DistanceAnnouncementBucket): string {
  return bucket === "soon" ? "まもなく" : `${bucket}m先`;
}

export function buildInstruction(step: RouteStep, bucket: DistanceAnnouncementBucket): string {
  const prefix = bucketLabel(bucket);
  return `${prefix} ${step.instruction}`;
}

export function maneuverToArrow(maneuver: string | null | undefined): string {
  if (!maneuver) {
    return "↑";
  }

  const normalized = maneuver.toLowerCase();
  if (normalized.includes("left")) {
    return "←";
  }
  if (normalized.includes("right")) {
    return "→";
  }
  if (normalized.includes("uturn")) {
    return "↺";
  }
  if (normalized.includes("merge")) {
    return "↗";
  }
  if (normalized.includes("roundabout")) {
    return "⟳";
  }
  return "↑";
}
