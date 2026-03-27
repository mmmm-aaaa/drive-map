import { LLM_RETRY_LIMIT } from "@drive-map/shared";
import { fetchWithTimeout } from "../lib/fetch-with-timeout";
import { UpstreamServiceError } from "../lib/upstream-error";
import { buildDestinationSelectionPrompt } from "../prompts/destination-selection";
import { parseLlmResponse, type LlmResponse } from "../schema/llm-response";

const SAKURA_CHAT_URL = "https://api.ai.sakura.ad.jp/v1/chat/completions";

type SelectDestinationInput = {
  origin: { lat: number; lng: number };
  durationMinutes: number;
  tollRoadsAllowed: boolean;
  feedback?: string;
};

type SakuraChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

function extractContent(payload: SakuraChatResponse): string {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => item.text ?? "")
      .join("")
      .trim();
  }

  throw new Error("Sakura response does not contain message content");
}

export async function selectDestinationByLlm(env: Env, input: SelectDestinationInput): Promise<LlmResponse> {
  const prompt = buildDestinationSelectionPrompt(input);

  const response = await fetchWithTimeout(
    SAKURA_CHAT_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.SAKURA_AI_API_KEY}`
      },
      body: JSON.stringify({
        model: env.SAKURA_AI_MODEL,
        messages: [
          {
            role: "system",
            content: "指定された制約で日本国内のドライブ目的地候補を JSON で返してください。"
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.5,
        response_format: {
          type: "json_object"
        }
      })
    },
    {
      timeoutMs: 3_000,
      retries: Math.min(1, LLM_RETRY_LIMIT),
      retryDelayMs: 250
    }
  ).catch((error) => {
    throw new UpstreamServiceError("sakura_chat", error instanceof Error ? error.message : "Sakura API request failed");
  });

  if (!response.ok) {
    throw new UpstreamServiceError("sakura_chat", `Sakura API returned HTTP ${response.status}`);
  }

  let responseJson: SakuraChatResponse;
  try {
    responseJson = (await response.json()) as SakuraChatResponse;
  } catch {
    throw new UpstreamServiceError("sakura_chat", "Failed to parse Sakura API response JSON");
  }

  const content = extractContent(responseJson);

  try {
    return parseLlmResponse(content);
  } catch (error) {
    throw new UpstreamServiceError("sakura_chat", error instanceof Error ? error.message : "Failed to validate LLM response");
  }
}
