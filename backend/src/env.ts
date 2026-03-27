import { envSchema, type ParsedEnv } from "./schema/env";

export function parseEnv(bindings: Env): ParsedEnv {
  return envSchema.parse(bindings) as ParsedEnv;
}
