import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** Dedicated config so `npm run export:starters` can write backend fixtures. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/design-pad/export-starters.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
