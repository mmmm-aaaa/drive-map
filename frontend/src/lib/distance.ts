import type { LatLng } from "@drive-map/shared";

const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

export function distanceBetweenMeters(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);

  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function projectToCartesianMeters(point: LatLng, referenceLat: number): { x: number; y: number } {
  const latRad = toRadians(referenceLat);
  const x = toRadians(point.lng) * EARTH_RADIUS_METERS * Math.cos(latRad);
  const y = toRadians(point.lat) * EARTH_RADIUS_METERS;
  return { x, y };
}

export function distancePointToSegmentMeters(point: LatLng, segmentStart: LatLng, segmentEnd: LatLng): number {
  const referenceLat = (segmentStart.lat + segmentEnd.lat) / 2;
  const p = projectToCartesianMeters(point, referenceLat);
  const a = projectToCartesianMeters(segmentStart, referenceLat);
  const b = projectToCartesianMeters(segmentEnd, referenceLat);

  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;

  const abLengthSq = abx * abx + aby * aby;
  if (abLengthSq === 0) {
    return Math.hypot(apx, apy);
  }

  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLengthSq));
  const closestX = a.x + abx * t;
  const closestY = a.y + aby * t;

  return Math.hypot(p.x - closestX, p.y - closestY);
}

export function minDistanceToPolylineMeters(point: LatLng, polyline: LatLng[]): number {
  if (polyline.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  if (polyline.length === 1) {
    const onlyPoint = polyline[0];
    if (!onlyPoint) {
      return Number.POSITIVE_INFINITY;
    }
    return distanceBetweenMeters(point, onlyPoint);
  }

  let minDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < polyline.length - 1; index += 1) {
    const start = polyline[index];
    const end = polyline[index + 1];
    if (!start || !end) {
      continue;
    }
    const distance = distancePointToSegmentMeters(point, start, end);
    if (distance < minDistance) {
      minDistance = distance;
    }
  }

  return minDistance;
}
