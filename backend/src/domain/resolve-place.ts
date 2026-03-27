import type { LatLng } from "@drive-map/shared";
import { searchPlacesByText, type ResolvedPlace } from "../services/google-places";

type ResolvePlaceInput = {
  query: string;
  origin: LatLng;
  durationMinutes: number;
  tollRoadsAllowed: boolean;
  signal?: AbortSignal;
};

export async function resolvePlace(env: Env, input: ResolvePlaceInput): Promise<ResolvedPlace | null> {
  const places = await searchPlacesByText(env, {
    query: input.query,
    origin: input.origin,
    durationMinutes: input.durationMinutes,
    tollRoadsAllowed: input.tollRoadsAllowed
  }, input.signal);

  return places[0] ?? null;
}
