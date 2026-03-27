import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@drive-map/shared": path.resolve(__dirname, "../shared/src/index.ts")
    }
  },
  server: {
    host: true,
    port: 5173
  }
});
