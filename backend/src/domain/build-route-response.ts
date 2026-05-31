import { DEFAULT_STEP_INSTRUCTION } from "@drive-map/shared";
import type { NavigationRoute, StartNavigationSuccessResponse } from "@drive-map/shared";

export function buildRouteResponse(route: NavigationRoute): StartNavigationSuccessResponse {
  return {
    status: "ok",
    route,
    ui: {
      initialInstruction: route.steps[0]?.instruction ?? DEFAULT_STEP_INSTRUCTION,
      showDestinationName: false
    }
  };
}
