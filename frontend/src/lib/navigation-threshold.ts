import type { DistanceAnnouncementBucket } from "@drive-map/shared";
import { NAVIGATION_DISTANCE_THRESHOLDS_METERS } from "@drive-map/shared";

export function toDistanceBucket(distanceMeters: number): DistanceAnnouncementBucket {
  if (distanceMeters < 50) {
    return "soon";
  }

  if (distanceMeters >= NAVIGATION_DISTANCE_THRESHOLDS_METERS[0]) {
    return 800;
  }
  if (distanceMeters >= NAVIGATION_DISTANCE_THRESHOLDS_METERS[1]) {
    return 600;
  }
  if (distanceMeters >= NAVIGATION_DISTANCE_THRESHOLDS_METERS[2]) {
    return 400;
  }
  if (distanceMeters >= NAVIGATION_DISTANCE_THRESHOLDS_METERS[3]) {
    return 200;
  }
  if (distanceMeters >= NAVIGATION_DISTANCE_THRESHOLDS_METERS[4]) {
    return 100;
  }
  return 50;
}
