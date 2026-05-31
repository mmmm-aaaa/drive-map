import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function jsonResponse(c: Context, status: ContentfulStatusCode, body: Record<string, unknown>): Response {
  return c.json(body, status);
}
