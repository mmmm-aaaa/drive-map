import type { StartNavigationResponse } from "@drive-map/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createRequestId, logInfo } from "./lib/logger";
import { jsonResponse } from "./lib/response";
import { registerHealthRoute } from "./routes/health";
import { registerNavigationStartRoute } from "./routes/navigation-start";

type AppBindings = {
  Bindings: Env;
  Variables: {
    requestId: string;
  };
};

const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(self), camera=(), microphone=(), fullscreen=(self)"
} as const;

export const app = new Hono<AppBindings>();

app.use("*", async (c, next) => {
  const requestId = createRequestId();
  const startTime = Date.now();
  c.set("requestId", requestId);

  await next();

  c.header("x-request-id", requestId);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(key, value);
  }

  const durationMs = Date.now() - startTime;
  logInfo({
    requestId,
    event: "request_completed",
    details: {
      method: c.req.method,
      path: new URL(c.req.url).pathname,
      status: c.res.status,
      durationMs
    }
  });
});

app.use(
  "/api/navigation/start",
  bodyLimit({
    maxSize: 2 * 1024,
    onError: (c) => {
      const response: StartNavigationResponse = {
        status: "validation_failed",
        message: "リクエストボディは 2KB 以内で送信してください。"
      };
      return jsonResponse(c, 413, response);
    }
  })
);

registerHealthRoute(app);
registerNavigationStartRoute(app);

app.notFound(async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }

  return c.text("Not Found", 404);
});
