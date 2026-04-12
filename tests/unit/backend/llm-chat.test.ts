import { LLM_PER_CALL_TIMEOUT_MS } from "@drive-map/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectDestinationByLlm } from "../../../backend/src/services/llm-chat";

function createEnv(): Env {
  return {
    LLM_API_KEY: "test-google-ai-studio-key",
    LLM_MODEL: "test-model",
    LLM_API_URL: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    APP_ORIGIN: "http://localhost:5173"
  } as Env;
}

describe("selectDestinationByLlm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("times out when the streamed response body stalls before a complete JSON payload arrives", async () => {
    const encoder = new TextEncoder();
    let cancelled = false;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('data: {"choices":[{"delta":{"content":"{\\"result\\":\\"ok\\","}}]}\n\n')
            );
          },
          cancel() {
            cancelled = true;
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "text/event-stream"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const request = expect(
      selectDestinationByLlm(createEnv(), {
        origin: { lat: 35.0, lng: 139.0 },
        durationMinutes: 90,
        tollRoadsAllowed: true
      })
    ).rejects.toMatchObject({
      service: "google-ai-studio",
      message: "LLM response body timed out"
    });

    await vi.advanceTimersByTimeAsync(LLM_PER_CALL_TIMEOUT_MS);

    await request;
    expect(cancelled).toBe(true);
  });
});
