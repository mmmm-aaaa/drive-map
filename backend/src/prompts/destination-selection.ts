import type { LatLng } from "@drive-map/shared";
import { estimateReachableDistanceKm } from "../domain/drive-estimate";

type BuildPromptParams = {
  origin: LatLng;
  durationMinutes: number;
  tollRoadsAllowed: boolean;
  feedback?: string;
};

export function buildDestinationSelectionPrompt(params: BuildPromptParams): string {
  const distanceKm = estimateReachableDistanceKm(params.durationMinutes, params.tollRoadsAllowed);
  const tollPolicy = params.tollRoadsAllowed ? "有料道路の利用は許可されています" : "有料道路は利用できません";
  const feedbackBlock = params.feedback ? `前回候補へのフィードバック: ${params.feedback}` : "前回候補へのフィードバック: なし";

  return [
    "あなたは日本国内のドライブ目的地候補を提案するアシスタントです。",
    "移動手段は車のみ、片道時間のみを考慮してください。",
    "必ず JSON だけを返してください。コードブロックは禁止です。",
    "",
    "返却 JSON 形式:",
    "{\"result\":\"ok\",\"candidates\":[{\"query\":\"地名や施設名\",\"reason\":\"理由\"}]} または {\"result\":\"no_match\"}",
    "",
    "制約:",
    `- 出発座標: lat=${params.origin.lat}, lng=${params.origin.lng}`,
    `- 希望片道時間: ${params.durationMinutes} 分`,
    `- ${tollPolicy}`,
    `- 目安到達圏: 約 ${distanceKm} km 以内を優先`,
    "- 候補は日本国内のみ",
    "- 候補数は最大 3 件",
    "- 曖昧すぎる語は避ける",
    feedbackBlock
  ].join("\n");
}
