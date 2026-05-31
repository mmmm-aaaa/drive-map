import { describe, expect, it } from "vitest";
import { buildDestinationSelectionPrompt } from "../../../backend/src/prompts/destination-selection";

const tokyoStation = { lat: 35.681236, lng: 139.767125 };

describe("buildDestinationSelectionPrompt", () => {
  it("includes region label, estimated distance, and duration window for Tokyo core", () => {
    const prompt = buildDestinationSelectionPrompt({
      origin: tokyoStation,
      durationMinutes: 90,
      tollRoadsAllowed: true
    });

    expect(prompt).toContain("全国的に有名かどうかは選定基準にしない");
    expect(prompt).toContain("地域ラベル（参考）: 東京都心部");
    expect(prompt).toContain("許容される片道時間帯: 72〜108 分（許容差 ±18 分）");
    expect(prompt).toContain("推定直線距離の目安: 約 70 km（推定道路距離: 約 91 km）");
    expect(prompt).toContain("ローカルな公園、道の駅");
    expect(prompt).toContain("Places Text Search で解決しやすい");
    expect(prompt).not.toContain("鎌倉");
    expect(prompt).toContain('{"result":"ok","queries":["三島市","秩父市","御殿場市"]}');
    expect(prompt).not.toContain("距離感の目安（東京駅発");
    expect(prompt).not.toContain('"query":"地名や施設名"');
    expect(prompt).toMatch(/\{"result":"ok","queries":/);
    expect(prompt).toContain('{"result":"no_match"}');
  });

  it("handles intermediate minute totals above the minimum", () => {
    const prompt = buildDestinationSelectionPrompt({
      origin: tokyoStation,
      durationMinutes: 61,
      tollRoadsAllowed: true
    });

    expect(prompt).toContain("希望片道時間: 61 分");
    expect(prompt).toContain("推定直線距離の目安: 約 36 km");
  });

  it("keeps mismatch feedback visible to steer the next retry", () => {
    const prompt = buildDestinationSelectionPrompt({
      origin: tokyoStation,
      durationMinutes: 90,
      tollRoadsAllowed: true,
      feedback: "候補「箱根」は片道139分で、希望90分より49分長すぎました。許容帯は72〜108分です。もっと近い候補を1件だけ返してください。"
    });

    expect(prompt).toContain("これまでの候補フィードバック（すべて考慮して次の候補を選ぶこと）:");
    expect(prompt).toContain("候補「箱根」は片道139分で、希望90分より49分長すぎました。許容帯は72〜108分です。もっと近い候補を1件だけ返してください。");
  });
});
