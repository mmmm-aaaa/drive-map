import type { Hono } from "hono";
import type { HealthResponse } from "@drive-map/shared";
import type { AppBindings } from "../app";

export function registerHealthRoute(app: Hono<AppBindings>): void {
  app.get("/api/health", (c) => {
    const response: HealthResponse = {
      status: "ok",
      service: "drive-map-worker",
      timestamp: new Date().toISOString()
    };

    return c.json(response);
  });
}
