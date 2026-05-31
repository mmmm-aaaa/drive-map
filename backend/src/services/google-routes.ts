import { DEFAULT_STEP_INSTRUCTION } from "@drive-map/shared";
import type { LatLng, NavigationRoute, RouteStep } from "@drive-map/shared";
import { RequestAbortedError } from "../lib/abort";
import { fetchWithTimeout } from "../lib/fetch-with-timeout";
import { UpstreamServiceError } from "../lib/upstream-error";

const GOOGLE_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";

type ComputeRouteParams = {
  origin: LatLng;
  destinationPlaceId: string;
  tollRoadsAllowed: boolean;
};

type GoogleLatLng = {
  latitude?: number;
  longitude?: number;
};

type GoogleRoutesResponse = {
  routes?: Array<{
    distanceMeters?: number;
    duration?: string;
    polyline?: { encodedPolyline?: string };
    legs?: Array<{
      steps?: Array<{
        distanceMeters?: number;
        staticDuration?: string;
        navigationInstruction?: { instructions?: string; maneuver?: string };
        polyline?: { encodedPolyline?: string };
        startLocation?: { latLng?: GoogleLatLng };
        endLocation?: { latLng?: GoogleLatLng };
      }>;
    }>;
  }>;
};

function parseDurationSeconds(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  if (!value.endsWith("s")) {
    return 0;
  }

  const parsed = Number(value.slice(0, -1));
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed));
}

function parseLatLng(value: GoogleLatLng | undefined): LatLng | null {
  const lat = value?.latitude;
  const lng = value?.longitude;

  if (typeof lat !== "number" || typeof lng !== "number") {
    return null;
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    lat,
    lng
  };
}

export async function computeRoute(env: Env, params: ComputeRouteParams, signal?: AbortSignal): Promise<NavigationRoute | null> {
  const response = await fetchWithTimeout(
    GOOGLE_ROUTES_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask":
          "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction.instructions,routes.legs.steps.navigationInstruction.maneuver,routes.legs.steps.polyline.encodedPolyline,routes.legs.steps.startLocation.latLng,routes.legs.steps.endLocation.latLng"
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: params.origin.lat,
              longitude: params.origin.lng
            }
          }
        },
        destination: {
          placeId: params.destinationPlaceId
        },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
        routeModifiers: {
          avoidTolls: !params.tollRoadsAllowed
        },
        computeAlternativeRoutes: false,
        languageCode: "ja",
        units: "METRIC"
      })
    },
    {
      timeoutMs: 2_000,
      retries: 0,
      retryDelayMs: 0,
      ...(signal ? { signal } : {})
    }
  ).catch((error) => {
    if (error instanceof RequestAbortedError) {
      throw error;
    }

    throw new UpstreamServiceError("google_routes", error instanceof Error ? error.message : "Google Routes API request failed");
  });

  if (!response.ok) {
    if (response.status === 400) {
      return null;
    }

    throw new UpstreamServiceError("google_routes", `Google Routes API returned HTTP ${response.status}`);
  }

  let payload: GoogleRoutesResponse;
  try {
    payload = (await response.json()) as GoogleRoutesResponse;
  } catch {
    throw new UpstreamServiceError("google_routes", "Failed to parse Google Routes response JSON");
  }

  const firstRoute = payload.routes?.[0];
  if (!firstRoute) {
    return null;
  }

  const stepsRaw = firstRoute.legs?.flatMap((leg) => leg.steps ?? []) ?? [];
  const routeSteps: RouteStep[] = [];
  let fallbackStart: LatLng = params.origin;

  for (const [index, step] of stepsRaw.entries()) {
    const startLocation = parseLatLng(step.startLocation?.latLng) ?? fallbackStart;
    const endLocation = parseLatLng(step.endLocation?.latLng) ?? startLocation;

    routeSteps.push({
      index,
      distanceMeters: Math.max(0, Math.round(step.distanceMeters ?? 0)),
      durationSeconds: parseDurationSeconds(step.staticDuration),
      instruction: step.navigationInstruction?.instructions?.trim() || DEFAULT_STEP_INSTRUCTION,
      maneuver: step.navigationInstruction?.maneuver ?? null,
      polyline: step.polyline?.encodedPolyline ?? "",
      startLocation,
      endLocation
    });

    fallbackStart = endLocation;
  }

  if (routeSteps.length === 0) {
    return null;
  }

  return {
    distanceMeters: Math.max(0, Math.round(firstRoute.distanceMeters ?? 0)),
    durationSeconds: parseDurationSeconds(firstRoute.duration),
    polyline: firstRoute.polyline?.encodedPolyline ?? "",
    steps: routeSteps
  };
}
