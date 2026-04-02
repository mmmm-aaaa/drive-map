import { z } from "zod";

export const envSchema = z.object({
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1).default("nvidia/nemotron-3-nano-30b-a3b:free"),
  LLM_API_URL: z.string().url().default("https://openrouter.ai/api/v1/chat/completions"),
  GOOGLE_MAPS_API_KEY: z.string().min(1),
  APP_ORIGIN: z.string().url().optional().or(z.literal("")).optional(),
  ALLOW_UNPROTECTED_START: z.enum(["true", "false"]).optional()
});

export type ParsedEnv = z.infer<typeof envSchema> & Env;
