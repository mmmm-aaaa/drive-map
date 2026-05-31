import { OFF_ROUTE_ACCURACY_MULTIPLIER, OFF_ROUTE_BASE_DISTANCE_METERS, ON_ROUTE_BASE_DISTANCE_METERS } from "@drive-map/shared";

export function offRouteThresholdMeters(accuracy: number): number {
  return Math.max(OFF_ROUTE_BASE_DISTANCE_METERS, accuracy * OFF_ROUTE_ACCURACY_MULTIPLIER);
}

export function onRouteThresholdMeters(accuracy: number): number {
  return Math.max(ON_ROUTE_BASE_DISTANCE_METERS, accuracy);
}

export function nextOffRouteConsecutiveCount(routeDistanceMeters: number, accuracy: number, previousCount: number): number {
  return routeDistanceMeters > offRouteThresholdMeters(accuracy) ? previousCount + 1 : 0;
}
