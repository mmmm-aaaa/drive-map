import type { LatLng } from "@drive-map/shared";

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

export function bearingDegrees(start: LatLng, end: LatLng): number {
  const lat1 = toRadians(start.lat);
  const lat2 = toRadians(end.lat);
  const diffLng = toRadians(end.lng - start.lng);

  const y = Math.sin(diffLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(diffLng);
  const bearing = toDegrees(Math.atan2(y, x));
  return (bearing + 360) % 360;
}

export function angularDifferenceDegrees(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}
