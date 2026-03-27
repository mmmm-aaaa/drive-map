export type LatLng = {
  lat: number;
  lng: number;
};

export type CurrentPosition = LatLng & {
  accuracy: number;
  heading: number | null;
  speed: number | null;
  timestamp: number;
};

export function isValidLatLng(input: LatLng): boolean {
  return Number.isFinite(input.lat) && Number.isFinite(input.lng) && input.lat >= -90 && input.lat <= 90 && input.lng >= -180 && input.lng <= 180;
}
