import type { LatLng, NavigationRoute } from "@drive-map/shared";
import { LLM_CANDIDATE_LIMIT, LLM_RETRY_LIMIT } from "@drive-map/shared";
import { UpstreamServiceError } from "../lib/upstream-error";
import { resolvePlace } from "./resolve-place";
import { validateRouteDuration } from "./validate-route-duration";
import { computeRoute } from "../services/google-routes";
import { selectDestinationByLlm } from "../services/sakura-chat";

type SelectDestinationInput = {
  origin: LatLng;
  durationMinutes: number;
  tollRoadsAllowed: boolean;
};

type SelectDestinationOk = {
  status: "ok";
  route: NavigationRoute;
};

type SelectDestinationNoMatch = {
  status: "no_match";
  message: string;
};

type SelectDestinationUpstreamError = {
  status: "upstream_error";
  message: string;
};

export type SelectDestinationResult = SelectDestinationOk | SelectDestinationNoMatch | SelectDestinationUpstreamError;

function buildNoMatchMessage(): SelectDestinationNoMatch {
  return {
    status: "no_match",
    message: "条件に合う行き先が見つかりませんでした。時間や有料道路設定を変更して再試行してください。"
  };
}

export async function selectDestination(input: SelectDestinationInput, env: Env): Promise<SelectDestinationResult> {
  let feedback: string | undefined;

  for (let llmAttempt = 0; llmAttempt <= LLM_RETRY_LIMIT; llmAttempt += 1) {
    try {
      const llmResponse = await selectDestinationByLlm(env, {
        origin: input.origin,
        durationMinutes: input.durationMinutes,
        tollRoadsAllowed: input.tollRoadsAllowed,
        ...(feedback ? { feedback } : {})
      });

      if (llmResponse.result === "no_match") {
        return buildNoMatchMessage();
      }

      const candidates = llmResponse.candidates.slice(0, LLM_CANDIDATE_LIMIT);

      for (const candidate of candidates) {
        const place = await resolvePlace(env, {
          query: candidate.query,
          origin: input.origin,
          durationMinutes: input.durationMinutes,
          tollRoadsAllowed: input.tollRoadsAllowed
        });

        if (!place) {
          feedback = `候補「${candidate.query}」は場所解決できませんでした。別候補を提案してください。`;
          continue;
        }

        const route = await computeRoute(env, {
          origin: input.origin,
          destinationPlaceId: place.id,
          tollRoadsAllowed: input.tollRoadsAllowed
        });

        if (!route) {
          feedback = `候補「${candidate.query}」ではルート取得できませんでした。別候補を提案してください。`;
          continue;
        }

        const durationValidation = validateRouteDuration(route.durationSeconds, input.durationMinutes);
        if (!durationValidation.ok) {
          feedback = `候補「${candidate.query}」は希望時間と${durationValidation.diffMinutes}分ずれました。許容は±${durationValidation.toleranceMinutes}分です。`;
          continue;
        }

        return {
          status: "ok",
          route
        };
      }
    } catch (error) {
      if (error instanceof UpstreamServiceError) {
        return {
          status: "upstream_error",
          message: `${error.service} との通信で失敗しました。時間をおいて再試行してください。`
        };
      }

      return {
        status: "upstream_error",
        message: "外部サービスとの通信に失敗しました。時間をおいて再試行してください。"
      };
    }
  }

  return buildNoMatchMessage();
}
