import type { LatLng } from "@drive-map/shared";
import { buildDriveEstimateContext } from "../domain/drive-estimate";
import { buildDurationWindowMinutes } from "../domain/validate-route-duration";

type BuildPromptParams = {
  origin: LatLng;
  durationMinutes: number;
  tollRoadsAllowed: boolean;
  feedback?: string;
};

export function buildDestinationSelectionPrompt(params: BuildPromptParams): string {
  const ctx = buildDriveEstimateContext(params.origin, params.durationMinutes, params.tollRoadsAllowed);
  const durationWindow = buildDurationWindowMinutes(params.durationMinutes);
  const tollPolicy = params.tollRoadsAllowed
    ? "有料道路の利用は許可されています（出発地点から高速道路のインターチェンジが近い場合は所要時間を少し短めに、遠い場合は時間を長めに見積もって候補を選定してください）"
    : "有料道路は利用できません";
  const feedbackBlock = params.feedback
    ? `これまでの候補フィードバック（すべて考慮して次の候補を選ぶこと）:\n${params.feedback}`
    : "前回候補のフィードバック: なし";

  return [
    "日本国内のドライブ目的地の候補を最大3件、優先度順に選んでください。",
    "最優先は、Google Routes で検証したときに希望片道時間へ合うことです。全国的に有名かどうかは選定基準にしないでください。",
    "有名地ばかりを優先せず、同じような代表観光地へ寄せず、時間条件に最も合う具体名を最大3件返してください。",
    "全国的に無名でも、Places Text Search で解決しやすい具体地名・施設名ならよいです（例: ローカルな公園、道の駅、湖、展望台、温泉地、資料館、神社仏閣など）。",
    "主要観光地は、所要時間の適合が最も良い場合に限って採用してください。",
    "移動手段は車のみ、片道時間のみを考慮してください。",
    "説明文や理由は不要です。必ず JSON だけを返してください。コードブロックは禁止です。",
    "",
    "返却 JSON（次のどちらか一方のみ。プレースホルダーや説明文を queries に書かない）:",
    "{\"result\":\"ok\",\"queries\":[\"三島市\",\"秩父市\",\"御殿場市\"]} のように queries に実在の具体名を最大3件入れる。",
    "適した候補がないときのみ {\"result\":\"no_match\"}",
    "",
    "制約:",
    `- 出発座標: lat=${params.origin.lat}, lng=${params.origin.lng}`,
    `- 地域ラベル（参考）: ${ctx.regionLabelJa}`,
    `- 希望片道時間: ${params.durationMinutes} 分`,
    `- 許容される片道時間帯: ${durationWindow.minAllowedMinutes}〜${durationWindow.maxAllowedMinutes} 分（許容差 ±${durationWindow.toleranceMinutes} 分）`,
    `- 出発地からの推定直線距離の目安: 約 ${ctx.estimatedDistanceKm} km（推定道路距離: 約 ${Math.round(ctx.estimatedDistanceKm * 1.3)} km）`,
    `- 推定直線距離と許容時間帯を優先して、近すぎる候補・遠すぎる候補は避けること`,
    `- ${tollPolicy}`,
    "- 候補は日本国内のみ",
    "- 抽象語ではなく、具体的な地名・施設名を返す",
    "- Places Text Search で解決しやすい具体名にする",
    "- queries には最大3件の候補を優先度順に入れる",
    "- 3件の候補はそれぞれ異なる地名・施設名にする",
    "- 希望片道時間は60分以上で、時間と分の組み合わせ（例: 61分、90分）で指定され得る。与えられた分数と推定直線距離に沿ってドライブに適した候補を選ぶ",
    "- 希望より明らかに短く着いてしまいそうな候補（例: 同一街区）だけは選ばない",
    "- 明らかに時間超過しそうな候補は選ばない",
    "- 日本の一般的な車移動として考え、極端に楽観的な平均速度を前提にしない",
    "",
    feedbackBlock
  ].join("\n");
}
