import type { LatLng, NavigationRoute } from "@drive-map/shared";
import { LLM_MODEL_SCHEDULE, LLM_PER_CALL_TIMEOUT_MS, MIN_REMAINING_FOR_RETRY_MS, RETRY_SAFETY_MARGIN_MS } from "@drive-map/shared";
import { RequestAbortedError } from "../lib/abort";
import { logStage } from "../lib/logger";
import { UpstreamServiceError } from "../lib/upstream-error";
import { isPlaceholderDestinationQuery } from "./llm-query-placeholder";
import { resolvePlace } from "./resolve-place";
import { validateRouteDuration } from "./validate-route-duration";
import { computeRoute } from "../services/google-routes";
import { selectDestinationByLlm } from "../services/llm-chat";

const LLM_UPSTREAM_SERVICE = "google-ai-studio";
const LLM_REASK_LIMIT = LLM_MODEL_SCHEDULE.length - 1;
const SAFE_QUERY_PATTERN = /[^\p{L}\p{N}\s\-・、。（）()「」]/gu;
const RETRYABLE_LLM_UPSTREAM_PATTERNS = [
  /HTTP 429/,
  /HTTP 5\d\d/,
  /\btime(?:d)?\s*out\b/i,
  /fetch failed/i,
  /request failed/i,
  /Failed to read LLM API stream/i,
  /Failed to parse streamed LLM response/i,
  /does not contain a body/i
] as const;

function sanitizeQuery(raw: string): string {
  return raw.replace(SAFE_QUERY_PATTERN, "").trim();
}

function isRetryableLlmUpstreamError(error: UpstreamServiceError): boolean {
  if (error.service !== LLM_UPSTREAM_SERVICE) {
    return false;
  }

  if (error.message.includes("invalid_")) {
    return false;
  }

  return RETRYABLE_LLM_UPSTREAM_PATTERNS.some((pattern) => pattern.test(error.message));
}

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

type SelectDestinationOptions = {
  signal?: AbortSignal | undefined;
  requestId?: string | undefined;
  deadlineMs?: number | undefined;
};

export async function selectDestination(
  input: SelectDestinationInput,
  env: Env,
  options?: SelectDestinationOptions
): Promise<SelectDestinationResult> {
  const { signal, requestId, deadlineMs } = options ?? {};
  const feedbackHistory: string[] = [];
  const startedAt = Date.now();
  let lastInvalidLlmResponseError: UpstreamServiceError | null = null;
  let lastRetryableLlmUpstreamError: UpstreamServiceError | null = null;

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
      const modelForAttempt = LLM_MODEL_SCHEDULE[attempt] ?? env.LLM_MODEL;
      const llmStartedAt = Date.now();
      logStage(requestId, "llm_started", {
        attemptNumber,
        model: modelForAttempt,
        durationMinutes: input.durationMinutes,
        tollRoadsAllowed: input.tollRoadsAllowed,
        llmTimeoutMs
      });

      const feedback = feedbackHistory.length > 0 ? feedbackHistory.join("\n") : undefined;

      let llmResponse;
      try {
        llmResponse = await selectDestinationByLlm(
          env,
          {
            origin: input.origin,
            durationMinutes: input.durationMinutes,
            tollRoadsAllowed: input.tollRoadsAllowed,
            ...(feedback ? { feedback } : {})
          },
          signal,
          requestId,
          llmTimeoutMs,
          modelForAttempt
        );
      } catch (llmError) {
        if (
          llmError instanceof UpstreamServiceError &&
          llmError.service === LLM_UPSTREAM_SERVICE &&
          llmError.message.includes("invalid_")
        ) {
          lastInvalidLlmResponseError = llmError;
          lastRetryableLlmUpstreamError = null;
          feedbackHistory.push(
            "前回の応答は JSON として解析できませんでした。必ず {\"result\":\"ok\",\"queries\":[\"地名\"]} 形式で返してください。"
          );
          logStage(requestId, "candidate_rejected", { attemptNumber, reason: "llm_malformed_json" });
          continue;
        }

        if (llmError instanceof UpstreamServiceError && isRetryableLlmUpstreamError(llmError)) {
          lastRetryableLlmUpstreamError = llmError;
          logStage(requestId, "llm_retryable_error", {
            attemptNumber,
            service: llmError.service,
            message: llmError.message
          });
          continue;
        }

        throw llmError;
      }

      lastInvalidLlmResponseError = null;
      lastRetryableLlmUpstreamError = null;
      logStage(requestId, "llm_completed", {
        attemptNumber,
        durationMs: Date.now() - llmStartedAt,
        result: llmResponse.result,
        candidateCount: llmResponse.result === "ok" ? llmResponse.queries.length : 0
      });

      if (llmResponse.result === "no_match") {
        return buildNoMatchMessage();
      }

      const candidateFeedback: string[] = [];

      for (let ci = 0; ci < llmResponse.queries.length; ci += 1) {
        const candidateIndex = ci + 1;
        const rawQuery = llmResponse.queries[ci];

        const query = sanitizeQuery(rawQuery);
        if (!query) {
          candidateFeedback.push(`候補${candidateIndex}が空でした。`);
          logStage(requestId, "candidate_rejected", { attemptNumber, candidateIndex, reason: "empty_after_sanitize" });
          continue;
        }

        if (isPlaceholderDestinationQuery(query)) {
          candidateFeedback.push(`候補${candidateIndex}「${rawQuery}」はテンプレート文言でした。`);
          logStage(requestId, "candidate_rejected", {
            attemptNumber,
            candidateIndex,
            reason: "llm_placeholder_query",
            searchQuery: query
          });
          continue;
        }

        const placeStartedAt = Date.now();
        logStage(requestId, "places_started", { attemptNumber, candidateIndex });

        const place = await resolvePlace(env, {
          query,
          origin: input.origin,
          durationMinutes: input.durationMinutes,
          tollRoadsAllowed: input.tollRoadsAllowed,
          ...(signal ? { signal } : {})
        });

        logStage(requestId, "places_completed", {
          attemptNumber,
          candidateIndex,
          durationMs: Date.now() - placeStartedAt,
          found: Boolean(place)
        });

        if (!place) {
          candidateFeedback.push(`候補${candidateIndex}「${query}」は場所解決できませんでした。`);
          logStage(requestId, "candidate_rejected", {
            attemptNumber,
            candidateIndex,
            reason: "place_unresolved"
          });
          continue;
        }

        const routesStartedAt = Date.now();
        logStage(requestId, "routes_started", { attemptNumber, candidateIndex });

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
          candidateIndex,
          durationMs: Date.now() - routesStartedAt,
          found: Boolean(route)
        });

        if (!route) {
          candidateFeedback.push(`候補${candidateIndex}「${query}」ではルートを組めませんでした。`);
          logStage(requestId, "candidate_rejected", {
            attemptNumber,
            candidateIndex,
            reason: "route_unavailable"
          });
          continue;
        }

        const durationValidation = validateRouteDuration(route.durationSeconds, input.durationMinutes);
        logStage(requestId, "route_validated", {
          attemptNumber,
          candidateIndex,
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
          const mismatchDescription =
            durationValidation.direction === "shorter"
              ? `${durationValidation.diffMinutes}分短すぎ`
              : `${durationValidation.diffMinutes}分長すぎ`;

          candidateFeedback.push(
            `候補${candidateIndex}「${query}」は片道${durationValidation.actualDurationMinutes}分で、` +
            `希望${input.durationMinutes}分より${mismatchDescription}（許容帯${durationValidation.minAllowedMinutes}〜${durationValidation.maxAllowedMinutes}分）。`
          );
          logStage(requestId, "candidate_rejected", {
            attemptNumber,
            candidateIndex,
            reason: "duration_mismatch",
            searchQuery: query,
            placeName: place.displayName,
            diffMinutes: durationValidation.diffMinutes,
            direction: durationValidation.direction,
            actualDurationMinutes: durationValidation.actualDurationMinutes
          });
          continue;
        }

        logStage(requestId, "selection_ok", {
          attemptNumber,
          candidateIndex,
          searchQuery: query,
          placeName: place.displayName
        });

        return {
          status: "ok",
          route
        };
      }

      if (candidateFeedback.length > 0) {
        feedbackHistory.push(
          candidateFeedback.join("\n") +
          "\n上記すべて不適合でした。別の候補を最大3件返してください。"
        );
      }
    }

    if (lastRetryableLlmUpstreamError) {
      throw lastRetryableLlmUpstreamError;
    }

    if (lastInvalidLlmResponseError) {
      throw lastInvalidLlmResponseError;
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
