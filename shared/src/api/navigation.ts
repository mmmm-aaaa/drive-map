import type { LatLng } from "../domain/location";
import type { NavigationRoute } from "../domain/route";
import type { StartNavigationStatus } from "../domain/status";

export type StartNavigationRequest = {
  origin: LatLng;
  durationMinutes: number;
};

export type StartNavigationSuccessResponse = {
  status: "ok";
  route: NavigationRoute;
  ui: {
    initialInstruction: string;
    showDestinationName: false;
  };
};

export type StartNavigationNoMatchResponse = {
  status: "no_match";
  message: string;
};

export type StartNavigationValidationFailedResponse = {
  status: "validation_failed";
  message: string;
  issues?: string[];
};

export type StartNavigationUpstreamErrorResponse = {
  status: "upstream_error";
  message: string;
};

export type StartNavigationResponse =
  | StartNavigationSuccessResponse
  | StartNavigationNoMatchResponse
  | StartNavigationValidationFailedResponse
  | StartNavigationUpstreamErrorResponse;

export function isStartNavigationStatus(value: string): value is StartNavigationStatus {
  return value === "ok" || value === "no_match" || value === "validation_failed" || value === "upstream_error";
}
