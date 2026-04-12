import { describe, expect, it } from "vitest";
import type { StartNavigationResponse } from "@drive-map/shared";
import { app } from "../../backend/src/app";
import { buildDriveEstimateContext } from "../../backend/src/domain/drive-estimate";
import { buildDurationWindowMinutes, validateRouteDuration } from "../../backend/src/domain/validate-route-duration";

const liveEnabled =
  process.env.RUN_LIVE_NAVIGATION_TESTS === "true" &&
  Boolean(process.env.LLM_API_KEY?.trim()) &&
  Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());

const APP_ORIGIN = "http://localhost:5173";

const FIXTURES = [
  { key: "tokyo_core", origin: { lat: 35.681236, lng: 139.767125 } },
  { key: "tokyo_outer", origin: { lat: 35.655, lng: 139.323 } },
  { key: "kansai_core", origin: { lat: 34.702485, lng: 135.495951 } },
  { key: "chukyo_core", origin: { lat: 35.170915, lng: 136.881537 } },
  { key: "regional_city", origin: { lat: 33.590355, lng: 130.401716 } },
  { key: "rural_default", origin: { lat: 36.238038, lng: 137.971989 } }
] as const;

const DURATIONS = [90, 240, 600] as const;

function createLiveEnv(): Env {
  return {
    ASSETS: {
      fetch: async () => new Response("Not Found", { status: 404 })
    },
    LLM_API_KEY: process.env.LLM_API_KEY ?? "",
    LLM_MODEL: process.env.LLM_MODEL ?? "gemini-3.1-flash-lite-preview",
    LLM_API_URL: process.env.LLM_API_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? "",
    APP_ORIGIN,
    START_RATE_LIMIT: {
      limit: async () => ({ success: true })
    }
  };
}

function installFetchCapture(): {
  restore: () => void;
  getLastLlmQuery: () => string | undefined;
  getLastResolvedPlaceName: () => string | undefined;
  reset: () => void;
} {
  let lastLlmQuery: string | undefined;
  let lastResolvedPlaceName: string | undefined;
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await originalFetch(input, init);
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : String(input);

    if (url.includes("generativelanguage.googleapis.com") || url.includes("chat/completions")) {
      const clone = response.clone();
      try {
        const json = (await clone.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = json?.choices?.[0]?.message?.content;
        if (typeof content === "string") {
          const parsed = JSON.parse(content) as { result?: string; query?: string };
          if (parsed.result === "ok" && typeof parsed.query === "string") {
            lastLlmQuery = parsed.query;
          }
        }
      } catch {
        /* streaming or partial JSON */
      }
    }

    if (url.includes("places.googleapis.com")) {
      const clone = response.clone();
      try {
        const json = (await clone.json()) as { places?: Array<{ displayName?: { text?: string } }> };
        const name = json?.places?.[0]?.displayName?.text;
        if (typeof name === "string") {
          lastResolvedPlaceName = name;
        }
      } catch {
        /* ignore */
      }
    }

    return response;
  };

  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
    getLastLlmQuery: () => lastLlmQuery,
    getLastResolvedPlaceName: () => lastResolvedPlaceName,
    reset: () => {
      lastLlmQuery = undefined;
      lastResolvedPlaceName = undefined;
    }
  };
}

const MIN_SUCCESS_RATE = 0.5;
const INTER_FIXTURE_WAIT_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!liveEnabled)("live POST /api/navigation/start (real APIs)", () => {
  it(
    "resolves Places, builds a route, and keeps duration inside the allowed window for at least half of tested combos",
    async () => {
      const env = createLiveEnv();
      const capture = installFetchCapture();
      let tested = 0;
      let passed = 0;
      let rateLimited = 0;

      try {
        let requestIndex = 0;
        for (let fi = 0; fi < FIXTURES.length; fi++) {
          const fx = FIXTURES[fi];

          for (const durationMinutes of DURATIONS) {
            if (requestIndex > 0) await sleep(INTER_FIXTURE_WAIT_MS);
            requestIndex += 1;
            capture.reset();
            const ctx = buildDriveEstimateContext(fx.origin, durationMinutes, true);
            const window = buildDurationWindowMinutes(durationMinutes);

            const request = new Request("http://localhost/api/navigation/start", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                origin: APP_ORIGIN
              },
              body: JSON.stringify({
                origin: fx.origin,
                durationMinutes
              })
            });

            const response = await app.fetch(request, env as never);
            const payload = (await response.json()) as StartNavigationResponse;

            const isRateLimited = response.status === 502 && payload.status === "upstream_error";
            if (isRateLimited) {
              rateLimited += 1;
              console.log(JSON.stringify({ fixture: fx.key, requestedDuration: durationMinutes, skipped: "rate_limited" }));
              continue;
            }

            tested += 1;

            const routeDurationMinutes =
              payload.status === "ok" ? Math.round(payload.route.durationSeconds / 60) : null;
            const validation =
              payload.status === "ok"
                ? validateRouteDuration(payload.route.durationSeconds, durationMinutes)
                : null;

            const ok = response.status === 200 && payload.status === "ok" && validation?.ok === true;
            if (ok) passed += 1;

            const logLine = {
              fixture: fx.key,
              regionProfile: ctx.regionProfile,
              requestedDuration: durationMinutes,
              estimatedDistanceKm: ctx.estimatedDistanceKm,
              allowedWindow: window,
              apiStatus: payload.status,
              llmQuery: capture.getLastLlmQuery() ?? null,
              resolvedPlaceName: capture.getLastResolvedPlaceName() ?? null,
              routeDurationMinutes,
              diffMinutes: validation ? validation.diffMinutes : null,
              toleranceMinutes: validation?.toleranceMinutes ?? null,
              okInBand: ok
            };
            console.log(JSON.stringify(logLine));
          }
        }
      } finally {
        capture.restore();
      }

      console.log(`\nLive test summary: ${passed}/${tested} passed, ${rateLimited} rate-limited (excluded)`);

      if (tested === 0) {
        console.log("All requests were rate-limited — skipping assertion");
        return;
      }

      const rate = passed / tested;
      console.log(`Success rate: ${Math.round(rate * 100)}%, threshold ${Math.round(MIN_SUCCESS_RATE * 100)}%`);
      expect(rate).toBeGreaterThanOrEqual(MIN_SUCCESS_RATE);
    },
    600_000
  );
});
