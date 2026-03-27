import { LLM_CANDIDATE_LIMIT } from "@drive-map/shared";
import { z } from "zod";

const llmCandidateSchema = z.object({
  query: z.string().trim().min(1).max(120),
  reason: z.string().trim().max(240).optional()
});

const llmOkSchema = z.object({
  result: z.literal("ok"),
  candidates: z.array(llmCandidateSchema).min(1).max(LLM_CANDIDATE_LIMIT)
});

const llmNoMatchSchema = z.object({
  result: z.literal("no_match")
});

export const llmResponseSchema = z.union([llmOkSchema, llmNoMatchSchema]);
export type LlmResponse = z.infer<typeof llmResponseSchema>;

export function parseLlmResponse(content: string): LlmResponse {
  const parsed = JSON.parse(content) as unknown;
  return llmResponseSchema.parse(parsed);
}
