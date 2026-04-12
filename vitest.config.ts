import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

function loadEnvToRecord(): Record<string, string> {
  const envPath = path.resolve(__dirname, ".env");
  if (!fs.existsSync(envPath)) return {};
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    env[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }
  return env;
}

export default defineConfig({
  envPrefix: ["LLM_", "GOOGLE_MAPS_", "RUN_LIVE_", "VITE_"],
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    env: loadEnvToRecord()
  },
  resolve: {
    alias: {
      "@drive-map/shared": path.resolve(__dirname, "shared/src/index.ts"),
      "@drive-map/shared/*": path.resolve(__dirname, "shared/src/*")
    }
  }
});
