import { z } from "zod";

const llmOkSchema = z.object({
  result: z.literal("ok"),
  queries: z.array(z.string().trim().min(1).max(120)).min(1).max(3)
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
