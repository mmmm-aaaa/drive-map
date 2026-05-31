import type { LatLng } from "./location";

export type RouteStep = {
  index: number;
  distanceMeters: number;
  durationSeconds: number;
  instruction: string;
  maneuver: string | null;
  polyline: string;
  startLocation: LatLng;
  endLocation: LatLng;
};

export type NavigationRoute = {
  distanceMeters: number;
  durationSeconds: number;
  polyline: string;
  steps: RouteStep[];
};
