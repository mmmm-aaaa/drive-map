import type { LatLng } from "@drive-map/shared";
import { estimateReachableDistanceKm } from "../domain/drive-estimate";
import { buildDurationWindowMinutes } from "../domain/validate-route-duration";

type BuildPromptParams = {
  origin: LatLng;
  durationMinutes: number;
  tollRoadsAllowed: boolean;
  feedback?: string;
};

export function buildDestinationSelectionPrompt(params: BuildPromptParams): string {
  const distanceKm = estimateReachableDistanceKm(params.durationMinutes, params.tollRoadsAllowed);
  const durationWindow = buildDurationWindowMinutes(params.durationMinutes);
  const tollPolicy = params.tollRoadsAllowed ? "有料道路の利用は許可されています" : "有料道路は利用できません";
  const feedbackBlock = params.feedback ? `前回候補のフィードバック: ${params.feedback}` : "前回候補のフィードバック: なし";

  return [
    "日本国内のドライブ目的地を1件だけ選んでください。",
    "最優先は、Google Routes で検証したときに希望片道時間へ近くなりやすい候補にすることです。",
    "移動手段は車のみ、片道時間のみを考慮してください。",
    "説明文や理由は不要です。必ず JSON だけを返してください。コードブロックは禁止です。",
    "",
    "返却 JSON 形式:",
    "{\"result\":\"ok\",\"query\":\"地名や施設名\"} または {\"result\":\"no_match\"}",
    "",
    "制約:",
    `- 出発座標: lat=${params.origin.lat}, lng=${params.origin.lng}`,
    `- 希望片道時間: ${params.durationMinutes} 分`,
    `- 許容される片道時間帯: ${durationWindow.minAllowedMinutes}〜${durationWindow.maxAllowedMinutes} 分（許容差 ±${durationWindow.toleranceMinutes} 分）`,
    `- 出発地から直線距離で約 ${distanceKm} km 圏内の候補を選ぶこと（道路距離はこれより長くなる）`,
    `- ${tollPolicy}`,
    "- 候補は日本国内のみ",
    "- 近すぎる候補や遠すぎる候補は避け、希望時間に近い候補を優先",
    "- 希望片道時間は60分以上で、時間と分の組み合わせ（例: 61分、90分）で指定され得る。与えられた分数と直線距離目安に沿ってドライブに適した候補を選ぶ",
    "- 希望より明らかに短く着いてしまいそうな候補（例: 同一街区）だけは選ばない",
    "- 明らかに時間超過しそうな候補は選ばない",
    "- 日本の一般的な車移動として考え、極端に楽観的な平均速度を前提にしない",
    "- 曖昧すぎる語は避ける",
    "- Places Text Search で解決しやすい具体名にする",
    "- 返す query は 1 件だけ",
    "",
    "距離感の目安（東京駅発・有料道路あり。希望が下の分数の間なら距離感を補間して候補の向きを合わせる）:",
    "- 60分 → 約50〜70km: 「鎌倉」「川越」",
    "- 90分 → 約70〜100km: 「箱根湯本」「横浜みなとみらい」（参考）",
    "- 120分 → 約80〜120km: 「箱根」「日光東照宮」",
    "- 180分 → 約150〜200km: 「軽井沢」「伊豆下田」",
    feedbackBlock
  ].join("\n");
}
