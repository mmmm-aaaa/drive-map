import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node"
  },
  resolve: {
    alias: {
      "@drive-map/shared": path.resolve(__dirname, "shared/src/index.ts"),
      "@drive-map/shared/*": path.resolve(__dirname, "shared/src/*")
    }
  }
});
