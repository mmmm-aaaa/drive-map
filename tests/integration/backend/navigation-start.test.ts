import { START_HARD_TIMEOUT_MS } from "@drive-map/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app } from "../../../backend/src/app";

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
    LLM_API_KEY: "test-openrouter-key",
    LLM_MODEL: "test-model",
    LLM_API_URL: "https://openrouter.ai/api/v1/chat/completions",
    GOOGLE_MAPS_API_KEY: "test-google-key",
    APP_ORIGIN: "http://localhost:5173",
    ALLOW_UNPROTECTED_START: "false",
    START_RATE_LIMIT: {
      limit: async () => ({ success: true })
    },
    ...overrides
  };
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
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  result: "ok",
                  query: "箱根"
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

    const request = new Request("http://localhost/api/navigation/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:5173"
      },
      body: JSON.stringify({
        origin: { lat: 35.0, lng: 139.0 },
        durationMinutes: 90,
        tollRoadsAllowed: true
      })
    });

    const response = await app.fetch(request, createEnv() as never);
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.status).toBe("ok");
    expect((payload.ui as Record<string, unknown>).showDestinationName).toBe(false);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
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
        durationMinutes: 90,
        tollRoadsAllowed: true
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
        durationMinutes: 10,
        tollRoadsAllowed: true
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
        durationMinutes: 90,
        tollRoadsAllowed: true
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
        durationMinutes: 90,
        tollRoadsAllowed: true
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

    const fetchMock = vi.fn().mockImplementationOnce((_input: RequestInfo | URL, init?: RequestInit) => {
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
        durationMinutes: 90,
        tollRoadsAllowed: true
      })
    });

    const responsePromise = app.fetch(request, createEnv() as never);
    await vi.advanceTimersByTimeAsync(START_HARD_TIMEOUT_MS);

    const response = await responsePromise;
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(502);
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
        durationMinutes: 90,
        tollRoadsAllowed: true
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
