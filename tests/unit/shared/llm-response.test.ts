import { describe, expect, it } from "vitest";
import { parseLlmResponse } from "../../../backend/src/schema/llm-response";

describe("parseLlmResponse", () => {
  it("parses ok result with a single query", () => {
    const parsed = parseLlmResponse(
      JSON.stringify({
        result: "ok",
        query: "箱根"
      })
    );

    expect(parsed.result).toBe("ok");
    if (parsed.result === "ok") {
      expect(parsed.query).toBe("箱根");
    }
  });

  it("parses no_match result", () => {
    const parsed = parseLlmResponse(JSON.stringify({ result: "no_match" }));
    expect(parsed.result).toBe("no_match");
  });

  it("throws for invalid schema", () => {
    expect(() =>
      parseLlmResponse(
        JSON.stringify({
          result: "ok",
          query: ""
        })
      )
    ).toThrow();
  });
});
