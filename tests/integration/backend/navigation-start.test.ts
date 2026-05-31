import { LLM_MODEL_GEMINI_FLASH_LITE, LLM_MODEL_SCHEDULE, START_HARD_TIMEOUT_MS } from "@drive-map/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../../backend/src/app";
import { estimatePlaceBiasRadiusMeters } from "../../../backend/src/domain/drive-estimate";

const LLM_FETCH_ATTEMPTS_PER_CALL = 3;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function createEnv(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    ASSETS: {
      fetch: async () => new Response("Not Found", { status: 404 })
    },
    LLM_API_KEY: "test-google-ai-studio-key",
    LLM_MODEL: LLM_MODEL_GEMINI_FLASH_LITE,
    LLM_API_URL: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    GOOGLE_MAPS_API_KEY: "test-google-key",
    APP_ORIGIN: "http://localhost:5173",
    ALLOW_UNPROTECTED_START: "false",
    START_RATE_LIMIT: {
      limit: async () => ({ success: true })
    },
    ...overrides
  };
}

function createStartRequest(origin = "http://localhost:5173"): Request {
  return new Request("http://localhost/api/navigation/start", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin
    },
    body: JSON.stringify({
      origin: { lat: 35.0, lng: 139.0 },
      durationMinutes: 90
    })
  });
}

function createSuccessfulNavigationFetchMock() {
  return vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                result: "ok",
                queries: ["箱根"]
              })
            }
          }
        ]
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        places: [{ id: "place-1", displayName: { text: "箱根" }, formattedAddress: "神奈川県足柄下郡箱根町" }]
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        routes: [
          {
            distanceMeters: 85000,
            duration: "5400s",
            polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
            legs: [
              {
                steps: [
                  {
                    distanceMeters: 1000,
                    staticDuration: "600s",
                    maneuver: "TURN_RIGHT",
                    navigationInstruction: { instructions: "右方向です" },
                    polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
                    startLocation: { latLng: { latitude: 35.0, longitude: 139.0 } },
                    endLocation: { latLng: { latitude: 35.01, longitude: 139.01 } }
                  }
                ]
              }
            ]
          }
        ]
      })
    );
}

/** 希望 600 分に合わせたルート所要（モック）で duration 検証を通す */
function createLongDurationNavigationFetchMock() {
  return vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                result: "ok",
                queries: ["箱根"]
              })
            }
          }
        ]
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        places: [{ id: "place-1", displayName: { text: "箱根" }, formattedAddress: "神奈川県足柄下郡箱根町" }]
      })
    )
    .mockResolvedValueOnce(
      jsonResponse({
        routes: [
          {
            distanceMeters: 850_000,
            duration: "36000s",
            polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
            legs: [
              {
                steps: [
                  {
                    distanceMeters: 1000,
                    staticDuration: "600s",
                    maneuver: "TURN_RIGHT",
                    navigationInstruction: { instructions: "右方向です" },
                    polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
                    startLocation: { latLng: { latitude: 35.0, longitude: 139.0 } },
                    endLocation: { latLng: { latitude: 35.01, longitude: 139.01 } }
                  }
                ]
              }
            ]
          }
        ]
      })
    );
}

describe("POST /api/navigation/start", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok for valid upstream responses", async () => {
    const fetchMock = createSuccessfulNavigationFetchMock();

    vi.stubGlobal("fetch", fetchMock);

    const request = createStartRequest();

    const response = await app.fetch(request, createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect((payload.ui as Record<string, unknown>).showDestinationName).toBe(false);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
  });

  it("retries destination selection after retryable LLM upstream failures and can still succeed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "rate limited" } }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "rate limited" } }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: { message: "rate limited" } }, 429))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  result: "ok",
                  queries: ["箱根"]
                })
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          places: [{ id: "place-1", displayName: { text: "箱根" }, formattedAddress: "神奈川県足柄下郡箱根町" }]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          routes: [
            {
              distanceMeters: 85000,
              duration: "5400s",
              polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
              legs: [
                {
                  steps: [
                    {
                      distanceMeters: 1000,
                      staticDuration: "600s",
                      maneuver: "TURN_RIGHT",
                      navigationInstruction: { instructions: "右方向です" },
                      polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
                      startLocation: { latLng: { latitude: 35.0, longitude: 139.0 } },
                      endLocation: { latLng: { latitude: 35.01, longitude: 139.01 } }
                    }
                  ]
                }
              ]
            }
          ]
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(createStartRequest(), createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("returns upstream_error after exhausting all retryable LLM upstream attempts", async () => {
    const fetchMock = vi.fn();
    const totalRetryableLlmFetches = LLM_MODEL_SCHEDULE.length * LLM_FETCH_ATTEMPTS_PER_CALL;

    for (let index = 0; index < totalRetryableLlmFetches; index += 1) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: { message: "rate limited" } }, 429));
    }

    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(createStartRequest(), createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(payload.status).toBe("upstream_error");
    expect(fetchMock).toHaveBeenCalledTimes(totalRetryableLlmFetches);
  }, 10_000);

  it("includes regional drive estimate fields in the LLM user prompt", async () => {
    const fetchMock = createSuccessfulNavigationFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    await app.fetch(createStartRequest(), createEnv() as never);

    const llmCall = fetchMock.mock.calls[0];
    const llmBody = JSON.parse((llmCall?.[1] as RequestInit).body as string) as {
      messages?: Array<{ role: string; content?: string }>;
    };
    const userContent = llmBody.messages?.find((m) => m.role === "user")?.content ?? "";
    expect(userContent).toContain("地域ラベル");
    expect(userContent).toContain("その他・地方域");
    expect(userContent).toContain("推定直線距離の目安");
  });

  it("sends Places Text Search a location bias radius from the origin-based drive estimate", async () => {
    const fetchMock = createSuccessfulNavigationFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const origin = { lat: 35.0, lng: 139.0 };
    const durationMinutes = 90;
    const tollRoadsAllowed = true;
    const expectedRadius = estimatePlaceBiasRadiusMeters(origin, durationMinutes, tollRoadsAllowed);

    await app.fetch(
      new Request("http://localhost/api/navigation/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:5173"
        },
        body: JSON.stringify({
          origin,
          durationMinutes
        })
      }),
      createEnv() as never
    );

    const placesCall = fetchMock.mock.calls.find((call) => {
      const url = typeof call[0] === "string" ? call[0] : (call[0] as Request).url;
      return url.includes("places.googleapis.com") && url.includes("searchText");
    });
    expect(placesCall).toBeDefined();

    const placesBody = JSON.parse((placesCall?.[1] as RequestInit).body as string) as {
      locationBias?: { circle?: { radius?: number; center?: { latitude?: number; longitude?: number } } };
    };
    expect(placesBody.locationBias?.circle?.radius).toBe(expectedRadius);
    expect(placesBody.locationBias?.circle?.center?.latitude).toBeCloseTo(origin.lat);
    expect(placesBody.locationBias?.circle?.center?.longitude).toBeCloseTo(origin.lng);
  });

  it("widens the duration window in the LLM prompt for long requests", async () => {
    const fetchMock = createLongDurationNavigationFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://localhost/api/navigation/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        origin: { lat: 35.0, lng: 139.0 },
        durationMinutes: 600
      })
    });

    const response = await app.fetch(request, createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");

    const llmCall = fetchMock.mock.calls[0];
    const llmBody = JSON.parse((llmCall?.[1] as RequestInit).body as string) as {
      messages?: Array<{ role: string; content?: string }>;
    };
    const userContent = llmBody.messages?.find((m) => m.role === "user")?.content ?? "";
    expect(userContent).toContain("許容される片道時間帯: 420〜780 分（許容差 ±180 分）");
  });

  it("retries destination selection up to the scheduled attempt count before returning no_match", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: JSON.stringify({ result: "ok", queries: ["地名や施設名"] }) } }]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: JSON.stringify({ result: "ok", queries: ["地名や施設名"] }) } }]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: JSON.stringify({ result: "ok", queries: ["地名や施設名"] }) } }]
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(createStartRequest(), createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("no_match");
    expect(fetchMock).toHaveBeenCalledTimes(LLM_MODEL_SCHEDULE.length);

    const llmModels = fetchMock.mock.calls
      .filter((call) => {
        const url = typeof call[0] === "string" ? call[0] : (call[0] as Request).url;
        return url.includes("generativelanguage.googleapis.com") || url.includes("chat/completions");
      })
      .map((call) => {
        const body = JSON.parse((call[1] as RequestInit).body as string) as { model?: string };
        return body.model;
      });
    expect(llmModels).toEqual(LLM_MODEL_SCHEDULE);
  });

  it("returns upstream_error when every LLM attempt returns malformed JSON content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: "not json" } }]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: "not json" } }]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: "not json" } }]
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(createStartRequest(), createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(payload.status).toBe("upstream_error");
    expect(fetchMock).toHaveBeenCalledTimes(LLM_MODEL_SCHEDULE.length);
  });

  it("applies env defaults when LLM_MODEL and LLM_API_URL are omitted", async () => {
    const fetchMock = createSuccessfulNavigationFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      createStartRequest(),
      createEnv({
        LLM_MODEL: undefined,
        LLM_API_URL: undefined
      }) as never
    );

    expect(response.status).toBe(200);

    const llmCall = fetchMock.mock.calls[0];
    expect(llmCall?.[0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    const llmRequestInit = llmCall?.[1] as RequestInit;
    const llmBody = JSON.parse(llmRequestInit.body as string) as { model?: string };
    expect(llmBody.model).toBe(LLM_MODEL_GEMINI_FLASH_LITE);
  });

  it("normalizes APP_ORIGIN with trailing slash", async () => {
    const fetchMock = createSuccessfulNavigationFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      createStartRequest(),
      createEnv({
        APP_ORIGIN: "http://localhost:5173/"
      }) as never
    );

    expect(response.status).toBe(200);
  });

  it("normalizes APP_ORIGIN with path", async () => {
    const fetchMock = createSuccessfulNavigationFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      createStartRequest(),
      createEnv({
        APP_ORIGIN: "http://localhost:5173/app"
      }) as never
    );

    expect(response.status).toBe(200);
  });

  it("returns no_match when LLM responds no_match", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                result: "no_match"
              })
            }
          }
        ]
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://localhost/api/navigation/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        origin: { lat: 35.0, lng: 139.0 },
        durationMinutes: 90
      })
    });

    const response = await app.fetch(request, createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("no_match");
  });

  it("returns validation_failed for invalid request", async () => {
    const request = new Request("http://localhost/api/navigation/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        origin: { lat: 35.0, lng: 139.0 },
        durationMinutes: 10
      })
    });

    const response = await app.fetch(request, createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(400);
    expect(payload.status).toBe("validation_failed");
  });

  it("rejects requests without origin header", async () => {
    const request = new Request("http://localhost/api/navigation/start", {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        origin: { lat: 35.0, lng: 139.0 },
        durationMinutes: 90
      })
    });

    const response = await app.fetch(request, createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(403);
    expect(payload.status).toBe("validation_failed");
  });

  it("fails closed when the start rate limit binding is missing", async () => {
    const request = new Request("http://localhost/api/navigation/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        origin: { lat: 35.0, lng: 139.0 },
        durationMinutes: 90
      })
    });

    const response = await app.fetch(
      request,
      createEnv({
        START_RATE_LIMIT: undefined
      }) as never
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(payload.status).toBe("upstream_error");
  });

  it("aborts a hanging LLM call via per-call timeout and returns upstream_error", async () => {
    vi.useFakeTimers();

    let aborted = false;

    const fetchMock = vi.fn().mockImplementation((_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;

      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://localhost/api/navigation/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        origin: { lat: 35.0, lng: 139.0 },
        durationMinutes: 90
      })
    });

    const responsePromise = app.fetch(request, createEnv() as never);
    await vi.advanceTimersByTimeAsync(START_HARD_TIMEOUT_MS);

    const response = await responsePromise;
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(504);
    expect(payload.status).toBe("upstream_error");
    expect(aborted).toBe(true);
  });

  it("aborts a stalled streaming LLM response via per-call timeout", async () => {
    vi.useFakeTimers();

    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array>;

    const fetchMock = vi.fn().mockImplementationOnce(() =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              streamController = controller;
              controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"{\\"result\\":"}}]}\n\n'));
            }
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } }
        )
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("http://localhost/api/navigation/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        origin: { lat: 35.0, lng: 139.0 },
        durationMinutes: 90
      })
    });

    const responsePromise = app.fetch(request, createEnv() as never);
    await vi.advanceTimersByTimeAsync(START_HARD_TIMEOUT_MS);

    const response = await responsePromise;
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(502);
    expect(payload.status).toBe("upstream_error");
  });
});

describe("GET /api/health", () => {
  it("returns health response with security headers", async () => {
    const response = await app.fetch(new Request("http://localhost/api/health"), createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
