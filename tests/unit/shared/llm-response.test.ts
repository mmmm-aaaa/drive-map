import { describe, expect, it } from "vitest";
import { parseLlmResponse } from "../../../backend/src/schema/llm-response";

describe("parseLlmResponse", () => {
  it("parses ok result with queries array", () => {
    const parsed = parseLlmResponse(
      JSON.stringify({
        result: "ok",
        queries: ["箱根", "三島市", "秩父市"]
      })
    );

    expect(parsed.result).toBe("ok");
    if (parsed.result === "ok") {
      expect(parsed.queries).toEqual(["箱根", "三島市", "秩父市"]);
    }
  });

  it("parses ok result with a single-element queries array", () => {
    const parsed = parseLlmResponse(
      JSON.stringify({
        result: "ok",
        queries: ["箱根"]
      })
    );

    expect(parsed.result).toBe("ok");
    if (parsed.result === "ok") {
      expect(parsed.queries).toEqual(["箱根"]);
    }
  });

  it("parses no_match result", () => {
    const parsed = parseLlmResponse(JSON.stringify({ result: "no_match" }));
    expect(parsed.result).toBe("no_match");
  });

  it("throws for empty queries array", () => {
    expect(() =>
      parseLlmResponse(
        JSON.stringify({
          result: "ok",
          queries: []
        })
      )
    ).toThrow();
  });

  it("throws for queries with empty string", () => {
    expect(() =>
      parseLlmResponse(
        JSON.stringify({
          result: "ok",
          queries: [""]
        })
      )
    ).toThrow();
  });

  it("throws for more than 3 queries", () => {
    expect(() =>
      parseLlmResponse(
        JSON.stringify({
          result: "ok",
          queries: ["a", "b", "c", "d"]
        })
      )
    ).toThrow();
  });
});
