import { z } from "zod";

export const envSchema = z.object({
  SAKURA_AI_API_KEY: z.string().min(1),
  SAKURA_AI_MODEL: z.string().min(1),
  GOOGLE_MAPS_API_KEY: z.string().min(1),
  APP_ORIGIN: z.string().url().optional().or(z.literal("")).optional()
});

export type ParsedEnv = z.infer<typeof envSchema> & Env;
