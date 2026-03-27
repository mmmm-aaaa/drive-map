import type { StartNavigationResponse } from "@drive-map/shared";
import type { NavigationStartRequestInput } from "../schema/navigation-start";
import { buildRouteResponse } from "../domain/build-route-response";
import { selectDestination } from "../domain/select-destination";

export async function handleStartNavigation(input: NavigationStartRequestInput, env: Env): Promise<StartNavigationResponse> {
  const result = await selectDestination(
    {
      origin: input.origin,
      durationMinutes: input.durationMinutes,
      tollRoadsAllowed: input.tollRoadsAllowed
    },
    env
  );

  if (result.status === "ok") {
    return buildRouteResponse(result.route);
  }

  return result;
}
