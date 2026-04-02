import type { StartNavigationResponse } from "@drive-map/shared";
import { START_HARD_TIMEOUT_MS } from "@drive-map/shared";
import type { NavigationStartRequestInput } from "../schema/navigation-start";
import { buildRouteResponse } from "../domain/build-route-response";
import { selectDestination } from "../domain/select-destination";

export async function handleStartNavigation(
  input: NavigationStartRequestInput,
  env: Env,
  signal?: AbortSignal,
  requestId?: string
): Promise<StartNavigationResponse> {
  const result = await selectDestination(
    {
      origin: input.origin,
      durationMinutes: input.durationMinutes,
      tollRoadsAllowed: input.tollRoadsAllowed
    },
    env,
    signal,
    requestId,
    START_HARD_TIMEOUT_MS
  );

  if (result.status === "ok") {
    return buildRouteResponse(result.route);
  }

  return result;
}
