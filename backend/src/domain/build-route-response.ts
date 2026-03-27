import type { NavigationRoute, StartNavigationSuccessResponse } from "@drive-map/shared";

export function buildRouteResponse(route: NavigationRoute): StartNavigationSuccessResponse {
  return {
    status: "ok",
    route,
    ui: {
      initialInstruction: route.steps[0]?.instruction ?? "そのまま進んでください",
      showDestinationName: false
    }
  };
}
