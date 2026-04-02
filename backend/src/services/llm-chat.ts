import { LLM_PER_CALL_TIMEOUT_MS, LLM_READ_TIMEOUT_MS } from "@drive-map/shared";
import { RequestAbortedError } from "../lib/abort";
import { FetchTimeoutError, fetchWithTimeout } from "../lib/fetch-with-timeout";
import { logStage as logLlmStage } from "../lib/logger";
import { UpstreamServiceError } from "../lib/upstream-error";
import { buildDestinationSelectionPrompt } from "../prompts/destination-selection";
import { parseLlmResponse, type LlmResponse } from "../schema/llm-response";

type LlmChatInput = {
  origin: { lat: number; lng: number };
  durationMinutes: number;
  tollRoadsAllowed: boolean;
  feedback?: string;
};

type LlmStandardResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

type LlmStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

function extractDeltaContent(payload: LlmStreamChunk): string {
  const content = payload.choices?.[0]?.delta?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text ?? "")
      .join("")
      .trim();
  }

  return "";
}

function extractMessageContent(payload: LlmStandardResponse): string {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text ?? "")
      .join("")
      .trim();
  }

  throw new Error("LLM response does not contain message content");
}

function tryParseCompletedResponse(content: string): LlmResponse | null {
  try {
    return parseLlmResponse(content);
  } catch {
    return null;
  }
}

function toAbortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new FetchTimeoutError("LLM response body timed out");
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return;
  }

  throw toAbortReason(signal);
}

function createReadTimeoutSignal(timeoutMs: number, parentSignal?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();

  const abortWithParentReason = (): void => {
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal) {
    parentSignal.addEventListener("abort", abortWithParentReason, { once: true });
  }

  const timeoutId = setTimeout(() => {
    controller.abort(new FetchTimeoutError("LLM response body timed out"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortWithParentReason);
    }
  };
}

function findEventDelimiter(buffer: string): { index: number; width: number } | null {
  const crlfIndex = buffer.indexOf("\r\n\r\n");
  const lfIndex = buffer.indexOf("\n\n");

  if (crlfIndex === -1 && lfIndex === -1) {
    return null;
  }

  if (crlfIndex === -1) {
    return { index: lfIndex, width: 2 };
  }

  if (lfIndex === -1) {
    return { index: crlfIndex, width: 4 };
  }

  return crlfIndex < lfIndex ? { index: crlfIndex, width: 4 } : { index: lfIndex, width: 2 };
}

async function readStreamedResponse(response: Response, requestId?: string, signal?: AbortSignal): Promise<LlmResponse> {
  if (!response.body) {
    throw new UpstreamServiceError("openrouter", "LLM API response does not contain a body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let firstChunkLogged = false;

  const cancelReader = (): void => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };

  if (signal) {
    signal.addEventListener("abort", cancelReader, { once: true });
  }

  const processEvent = async (rawEvent: string): Promise<LlmResponse | null> => {
    const dataLines = rawEvent
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (dataLines.length === 0) {
      return null;
    }

    const data = dataLines.join("\n");
    if (data === "[DONE]") {
      return tryParseCompletedResponse(content.trim());
    }

    let parsedChunk: LlmStreamChunk;
    try {
      parsedChunk = JSON.parse(data) as LlmStreamChunk;
    } catch {
      return null;
    }

    const delta = extractDeltaContent(parsedChunk);
    if (!delta) {
      return null;
    }

    content += delta;

    if (!firstChunkLogged && requestId) {
      firstChunkLogged = true;
      logLlmStage(requestId, "llm_first_chunk_received", {
        accumulatedLength: content.length
      });
    }

    const completed = tryParseCompletedResponse(content.trim());
    if (completed) {
      await reader.cancel();
      return completed;
    }

    return null;
  };

  try {
    while (true) {
      throwIfAborted(signal);

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal?.aborted) {
          throw toAbortReason(signal);
        }
        throw error;
      }

      const { done, value } = chunk;
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      let delimiter = findEventDelimiter(buffer);
      while (delimiter) {
        const rawEvent = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter.width);

        const completed = await processEvent(rawEvent);
        if (completed) {
          return completed;
        }

        delimiter = findEventDelimiter(buffer);
      }

      if (done) {
        buffer += decoder.decode();
        break;
      }
    }

    throwIfAborted(signal);

    const fallback = tryParseCompletedResponse(content.trim());
    if (fallback) {
      return fallback;
    }

    throw new UpstreamServiceError("openrouter", "Failed to parse streamed LLM response");
  } finally {
    signal?.removeEventListener("abort", cancelReader);
  }
}

async function readResponseText(response: Response, signal?: AbortSignal): Promise<string> {
  if (!response.body) {
    throw new UpstreamServiceError("openrouter", "LLM API response does not contain a body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";

  const cancelReader = (): void => {
    void reader.cancel(signal?.reason).catch(() => undefined);
  };

  if (signal) {
    signal.addEventListener("abort", cancelReader, { once: true });
  }

  try {
    while (true) {
      throwIfAborted(signal);

      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (signal?.aborted) {
          throw toAbortReason(signal);
        }
        throw error;
      }

      const { done, value } = chunk;
      text += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      if (done) {
        text += decoder.decode();
        throwIfAborted(signal);
        return text;
      }
    }
  } finally {
    signal?.removeEventListener("abort", cancelReader);
  }
}

async function readStandardResponse(response: Response, requestId?: string, signal?: AbortSignal): Promise<LlmResponse> {
  const text = await readResponseText(response, signal);
  logLlmStage(requestId, "llm_raw_body", {
    length: text.length,
    preview: text.slice(0, 200)
  });

  let payload: LlmStandardResponse;
  try {
    payload = JSON.parse(text) as LlmStandardResponse;
  } catch {
    throw new UpstreamServiceError("openrouter", "LLM API returned invalid JSON");
  }

  return parseLlmResponse(extractMessageContent(payload));
}

function buildHeaders(env: Env): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${env.LLM_API_KEY}`
  };

  if (env.APP_ORIGIN) {
    headers["HTTP-Referer"] = env.APP_ORIGIN;
  }

  headers["X-Title"] = "drive-map";

  return headers;
}

export async function selectDestinationByLlm(
  env: Env,
  input: LlmChatInput,
  signal?: AbortSignal,
  requestId?: string,
  timeoutMs: number = LLM_PER_CALL_TIMEOUT_MS
): Promise<LlmResponse> {
  const effectiveTimeoutMs = Math.max(1, timeoutMs);
  const prompt = buildDestinationSelectionPrompt(input);
  const fetchStartedAt = Date.now();
  logLlmStage(requestId, "llm_fetch_started", {
    promptLength: prompt.length,
    timeoutMs: effectiveTimeoutMs
  });

  const response = await fetchWithTimeout(
    env.LLM_API_URL,
    {
      method: "POST",
      headers: buildHeaders(env),
      body: JSON.stringify({
        model: env.LLM_MODEL,
        messages: [
          {
            role: "system",
            content: "指定された制約で日本国内のドライブ目的地を1件だけ JSON で返してください。理由や説明は不要です。"
          },
          {
            role: "user",
            content: prompt
          }
        ],
        stream: false,
        temperature: 0.5,
        max_tokens: 64,
        response_format: {
          type: "json_object"
        }
      })
    },
    {
      timeoutMs: effectiveTimeoutMs,
      retries: 2,
      retryDelayMs: 1_000,
      ...(signal ? { signal } : {})
    }
  ).catch((error) => {
    if (error instanceof RequestAbortedError) {
      throw error;
    }

    throw new UpstreamServiceError("openrouter", error instanceof Error ? error.message : "LLM API request failed");
  });

  logLlmStage(requestId, "llm_headers_received", {
    durationMs: Date.now() - fetchStartedAt,
    status: response.status,
    contentType: response.headers.get("content-type") ?? ""
  });

  if (!response.ok) {
    throw new UpstreamServiceError("openrouter", `LLM API returned HTTP ${response.status}`);
  }

  const jsonStartedAt = Date.now();
  const contentType = response.headers.get("content-type") ?? "";
  const fetchElapsedMs = jsonStartedAt - fetchStartedAt;
  const callerRemainingMs = effectiveTimeoutMs - fetchElapsedMs;
  const remainingReadTimeoutMs = Math.max(1, Math.min(LLM_READ_TIMEOUT_MS, callerRemainingMs));
  const { signal: readSignal, cleanup: cleanupReadTimeout } = createReadTimeoutSignal(remainingReadTimeoutMs, signal);
  let parsed: LlmResponse;

  try {
    const responseReader = contentType.includes("text/event-stream")
      ? readStreamedResponse(response, requestId, readSignal)
      : readStandardResponse(response, requestId, readSignal);
    parsed = await responseReader.catch((error) => {
      if (error instanceof UpstreamServiceError) {
        throw error;
      }

      throw new UpstreamServiceError("openrouter", error instanceof Error ? error.message : "Failed to read LLM API stream");
    });
  } finally {
    cleanupReadTimeout();
  }

  logLlmStage(requestId, "llm_json_parsed", {
    durationMs: Date.now() - jsonStartedAt
  });

  logLlmStage(requestId, "llm_validation_completed", {
    result: parsed.result,
    hasQuery: parsed.result === "ok"
  });
  return parsed;
}
