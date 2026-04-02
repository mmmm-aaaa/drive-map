import type { LatLng, NavigationRoute } from "@drive-map/shared";
import { LLM_PER_CALL_TIMEOUT_MS, MIN_REMAINING_FOR_RETRY_MS, RETRY_SAFETY_MARGIN_MS } from "@drive-map/shared";
import { RequestAbortedError } from "../lib/abort";
import { logInfo } from "../lib/logger";
import { UpstreamServiceError } from "../lib/upstream-error";
import { resolvePlace } from "./resolve-place";
import { validateRouteDuration } from "./validate-route-duration";
import { computeRoute } from "../services/google-routes";
import { selectDestinationByLlm } from "../services/llm-chat";

const LLM_REASK_LIMIT = 2;

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

function logStage(requestId: string | undefined, event: string, details?: Record<string, unknown>): void {
  if (!requestId) {
    return;
  }

  logInfo({
    requestId,
    event,
    ...(details ? { details } : {})
  });
}

export async function selectDestination(
  input: SelectDestinationInput,
  env: Env,
  signal?: AbortSignal,
  requestId?: string,
  deadlineMs?: number
): Promise<SelectDestinationResult> {
  let feedback: string | undefined;
  const startedAt = Date.now();

  try {
    for (let attempt = 0; attempt <= LLM_REASK_LIMIT; attempt += 1) {
      if (signal?.aborted) {
        throw new RequestAbortedError("Aborted before LLM retry");
      }

      const elapsedMs = Date.now() - startedAt;
      const remainingMs = deadlineMs !== undefined ? deadlineMs - elapsedMs - RETRY_SAFETY_MARGIN_MS : Infinity;

      if (attempt > 0 && remainingMs < MIN_REMAINING_FOR_RETRY_MS) {
        logStage(requestId, "retry_skipped_insufficient_time", {
          attemptNumber: attempt + 1,
          remainingMs: Math.max(0, remainingMs),
          minRequiredMs: MIN_REMAINING_FOR_RETRY_MS
        });
        break;
      }

      const llmTimeoutMs = remainingMs === Infinity ? LLM_PER_CALL_TIMEOUT_MS : Math.min(LLM_PER_CALL_TIMEOUT_MS, remainingMs);

      const attemptNumber = attempt + 1;
      const llmStartedAt = Date.now();
      logStage(requestId, "llm_started", {
        attemptNumber,
        durationMinutes: input.durationMinutes,
        tollRoadsAllowed: input.tollRoadsAllowed,
        llmTimeoutMs
      });

      const llmResponse = await selectDestinationByLlm(
        env,
        {
          origin: input.origin,
          durationMinutes: input.durationMinutes,
          tollRoadsAllowed: input.tollRoadsAllowed,
          ...(feedback ? { feedback } : {})
        },
        signal,
        requestId,
        llmTimeoutMs
      );

      logStage(requestId, "llm_completed", {
        attemptNumber,
        durationMs: Date.now() - llmStartedAt,
        result: llmResponse.result,
        hasQuery: llmResponse.result === "ok"
      });

      if (llmResponse.result === "no_match") {
        return buildNoMatchMessage();
      }

      const placeStartedAt = Date.now();
      logStage(requestId, "places_started", {
        attemptNumber
      });

      const place = await resolvePlace(env, {
        query: llmResponse.query,
        origin: input.origin,
        durationMinutes: input.durationMinutes,
        tollRoadsAllowed: input.tollRoadsAllowed,
        ...(signal ? { signal } : {})
      });

      logStage(requestId, "places_completed", {
        attemptNumber,
        durationMs: Date.now() - placeStartedAt,
        found: Boolean(place)
      });

      if (!place) {
        feedback = `候補「${llmResponse.query}」は場所解決できませんでした。別の地名を1件だけ返してください。`;
        logStage(requestId, "candidate_rejected", {
          attemptNumber,
          reason: "place_unresolved"
        });
        continue;
      }

      const routesStartedAt = Date.now();
      logStage(requestId, "routes_started", {
        attemptNumber
      });

      const route = await computeRoute(
        env,
        {
          origin: input.origin,
          destinationPlaceId: place.id,
          tollRoadsAllowed: input.tollRoadsAllowed
        },
        signal
      );

      logStage(requestId, "routes_completed", {
        attemptNumber,
        durationMs: Date.now() - routesStartedAt,
        found: Boolean(route)
      });

      if (!route) {
        feedback = `候補「${llmResponse.query}」ではルートを組めませんでした。別の地名を1件だけ返してください。`;
        logStage(requestId, "candidate_rejected", {
          attemptNumber,
          reason: "route_unavailable"
        });
        continue;
      }

      const durationValidation = validateRouteDuration(route.durationSeconds, input.durationMinutes);
      logStage(requestId, "route_validated", {
        attemptNumber,
        ok: durationValidation.ok,
        ...(durationValidation.ok
          ? {}
          : {
              diffMinutes: durationValidation.diffMinutes,
              toleranceMinutes: durationValidation.toleranceMinutes,
              direction: durationValidation.direction,
              actualDurationMinutes: durationValidation.actualDurationMinutes,
              minAllowedMinutes: durationValidation.minAllowedMinutes,
              maxAllowedMinutes: durationValidation.maxAllowedMinutes
            })
      });

      if (!durationValidation.ok) {
        const retryInstruction =
          durationValidation.direction === "shorter" ? "もっと遠い候補を1件だけ返してください。" : "もっと近い候補を1件だけ返してください。";
        const mismatchDescription =
          durationValidation.direction === "shorter"
            ? `${durationValidation.diffMinutes}分短すぎました`
            : `${durationValidation.diffMinutes}分長すぎました`;

        feedback =
          `候補「${llmResponse.query}」は片道${durationValidation.actualDurationMinutes}分で、` +
          `希望${input.durationMinutes}分より${mismatchDescription}。` +
          `許容帯は${durationValidation.minAllowedMinutes}〜${durationValidation.maxAllowedMinutes}分です。` +
          retryInstruction;
        logStage(requestId, "candidate_rejected", {
          attemptNumber,
          reason: "duration_mismatch",
          diffMinutes: durationValidation.diffMinutes,
          direction: durationValidation.direction,
          actualDurationMinutes: durationValidation.actualDurationMinutes
        });
        continue;
      }

      return {
        status: "ok",
        route
      };
    }

    return buildNoMatchMessage();
  } catch (error) {
    if (error instanceof RequestAbortedError) {
      logStage(requestId, "selection_aborted");
      throw error;
    }

    if (error instanceof UpstreamServiceError) {
      logStage(requestId, "selection_upstream_error", {
        service: error.service,
        message: error.message
      });
      return {
        status: "upstream_error",
        message: `${error.service} との通信で失敗しました。時間をおいて再試行してください。`
      };
    }

    logStage(requestId, "selection_unknown_error", {
      message: error instanceof Error ? error.message : "Unknown error"
    });
    return {
      status: "upstream_error",
      message: "外部サービスとの通信に失敗しました。時間をおいて再試行してください。"
    };
  }
}
