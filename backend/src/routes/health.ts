import type { Hono } from "hono";
import type { HealthResponse } from "@drive-map/shared";

export function registerHealthRoute(app: Hono<{ Bindings: Env; Variables: { requestId: string } }>): void {
  app.get("/api/health", (c) => {
    const response: HealthResponse = {
      status: "ok",
      service: "drive-map-worker",
      timestamp: new Date().toISOString()
    };

    return c.json(response);
  });
}
