import { describe, expect, it } from "vitest";
import { parseLlmResponse } from "../../../backend/src/schema/llm-response";

describe("parseLlmResponse", () => {
  it("parses ok result with candidates", () => {
    const parsed = parseLlmResponse(
      JSON.stringify({
        result: "ok",
        candidates: [{ query: "箱根", reason: "山道ドライブ向け" }]
      })
    );

    expect(parsed.result).toBe("ok");
    if (parsed.result === "ok") {
      expect(parsed.candidates[0]?.query).toBe("箱根");
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
          candidates: []
        })
      )
    ).toThrow();
  });
});
