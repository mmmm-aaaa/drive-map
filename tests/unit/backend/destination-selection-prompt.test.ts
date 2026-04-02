import { describe, expect, it } from "vitest";
import { buildDestinationSelectionPrompt } from "../../../backend/src/prompts/destination-selection";

describe("buildDestinationSelectionPrompt", () => {
  it("emphasizes the acceptable one-way duration window", () => {
    const prompt = buildDestinationSelectionPrompt({
      origin: { lat: 35.681236, lng: 139.767125 },
      durationMinutes: 90,
      tollRoadsAllowed: true
    });

    expect(prompt).toContain("最優先は、Google Routes で検証したときに希望片道時間へ近くなりやすい候補にすることです。");
    expect(prompt).toContain("許容される片道時間帯: 72〜108 分（許容差 ±18 分）");
    expect(prompt).toContain("出発地から直線距離で約 120 km 圏内の候補を選ぶこと");
    expect(prompt).toContain("近すぎる候補や遠すぎる候補は避け、希望時間に近い候補を優先");
    expect(prompt).toContain("希望片道時間は60分以上で、時間と分の組み合わせ（例: 61分、90分）");
    expect(prompt).toContain("希望より明らかに短く着いてしまいそうな候補");
    expect(prompt).toContain("明らかに時間超過しそうな候補は選ばない");
    expect(prompt).toContain("距離感の目安");
  });

  it("handles intermediate minute totals above the minimum", () => {
    const prompt = buildDestinationSelectionPrompt({
      origin: { lat: 35.681236, lng: 139.767125 },
      durationMinutes: 61,
      tollRoadsAllowed: true
    });

    expect(prompt).toContain("希望片道時間: 61 分");
    expect(prompt).toContain("出発地から直線距離で約 81 km 圏内の候補を選ぶこと");
    expect(prompt).toContain("60分 → 約50〜70km");
  });

  it("keeps mismatch feedback visible to steer the next retry", () => {
    const prompt = buildDestinationSelectionPrompt({
      origin: { lat: 35.681236, lng: 139.767125 },
      durationMinutes: 90,
      tollRoadsAllowed: true,
      feedback: "候補「箱根」は片道139分で、希望90分より49分長すぎました。許容帯は72〜108分です。もっと近い候補を1件だけ返してください。"
    });

    expect(prompt).toContain("前回候補のフィードバック: 候補「箱根」は片道139分で、希望90分より49分長すぎました。許容帯は72〜108分です。もっと近い候補を1件だけ返してください。");
  });
});
