import { envSchema, type ParsedEnv } from "./schema/env";

export function parseEnv(bindings: Env): ParsedEnv {
  const parsed = envSchema.parse(bindings);
  return { ...bindings, ...parsed } as ParsedEnv;
}
