import { PLACE_RESULT_LIMIT } from "@drive-map/shared";
import type { LatLng } from "@drive-map/shared";
import { RequestAbortedError } from "../lib/abort";
import { fetchWithTimeout } from "../lib/fetch-with-timeout";
import { UpstreamServiceError } from "../lib/upstream-error";
import { estimatePlaceBiasRadiusMeters } from "../domain/drive-estimate";

const GOOGLE_PLACES_TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";

export type ResolvedPlace = {
  id: string;
  displayName: string;
  formattedAddress: string | null;
};

type SearchPlaceParams = {
  query: string;
  origin: LatLng;
  durationMinutes: number;
  tollRoadsAllowed: boolean;
};

type GooglePlacesResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
  }>;
};

export async function searchPlacesByText(env: Env, params: SearchPlaceParams, signal?: AbortSignal): Promise<ResolvedPlace[]> {
  const biasRadiusMeters = estimatePlaceBiasRadiusMeters(params.origin, params.durationMinutes, params.tollRoadsAllowed);
  const requestBody = {
    textQuery: params.query,
    maxResultCount: PLACE_RESULT_LIMIT,
    locationBias: {
      circle: {
        center: {
          latitude: params.origin.lat,
          longitude: params.origin.lng
        },
        radius: biasRadiusMeters
      }
    }
  };

  const response = await fetchWithTimeout(
    GOOGLE_PLACES_TEXT_SEARCH_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName.text,places.formattedAddress"
      },
      body: JSON.stringify(requestBody)
    },
    {
      timeoutMs: 1_500,
      retries: 1,
      retryDelayMs: 250,
      ...(signal ? { signal } : {})
    }
  ).catch((error) => {
    if (error instanceof RequestAbortedError) {
      throw error;
    }

    throw new UpstreamServiceError("google_places", error instanceof Error ? error.message : "Google Places API request failed");
  });

  if (!response.ok) {
    throw new UpstreamServiceError("google_places", `Google Places API returned HTTP ${response.status}`);
  }

  let payload: GooglePlacesResponse;
  try {
    payload = (await response.json()) as GooglePlacesResponse;
  } catch {
    throw new UpstreamServiceError("google_places", "Failed to parse Google Places response JSON");
  }

  const places = payload.places ?? [];
  const mapped = places
    .map((place) => {
      if (!place.id) {
        return null;
      }

      return {
        id: place.id,
        displayName: place.displayName?.text ?? place.formattedAddress ?? "候補地",
        formattedAddress: place.formattedAddress ?? null
      } satisfies ResolvedPlace;
    })
    .filter((place): place is ResolvedPlace => place !== null);

  return mapped.slice(0, PLACE_RESULT_LIMIT);
}
