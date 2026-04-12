import { describe, expect, it } from "vitest";
import { isPlaceholderDestinationQuery } from "../../../backend/src/domain/llm-query-placeholder";

describe("isPlaceholderDestinationQuery", () => {
  it("flags template text copied from old prompts", () => {
    expect(isPlaceholderDestinationQuery("地名や施設名")).toBe(true);
    expect(isPlaceholderDestinationQuery("地名・施設名")).toBe(true);
  });

  it("ignores whitespace when matching", () => {
    expect(isPlaceholderDestinationQuery(" 地名や施設名 ")).toBe(true);
    expect(isPlaceholderDestinationQuery("地名 や 施設名")).toBe(true);
  });

  it("does not flag real place queries", () => {
    expect(isPlaceholderDestinationQuery("箱根湯本")).toBe(false);
    expect(isPlaceholderDestinationQuery("鎌倉")).toBe(false);
    expect(isPlaceholderDestinationQuery("川越")).toBe(false);
  });
});
