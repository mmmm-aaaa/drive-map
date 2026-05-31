import { z } from "zod";

export const envSchema = z.object({
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1).default("gemini-3.1-flash-lite-preview"),
  LLM_API_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"),
  GOOGLE_MAPS_API_KEY: z.string().min(1),
  APP_ORIGIN: z.string().url().min(1).optional().or(z.literal("")),
  ALLOW_UNPROTECTED_START: z.enum(["true", "false"]).optional()
});

export type ParsedEnv = z.infer<typeof envSchema> & Env;
