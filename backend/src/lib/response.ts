import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function jsonResponse<T>(c: Context, status: ContentfulStatusCode, body: T): Response {
  return c.json(body as never, status);
}
