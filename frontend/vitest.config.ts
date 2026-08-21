import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["src/design-pad/export-starters.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/test/**",
        "src/**/*.d.ts",
        // Route shells — covered via higher-level/E2E, not unit thresholds.
        "src/app/**/page.tsx",
        "src/app/layout.tsx",
        "src/lib/empty-polyfill.ts",
        // Thin page wrappers / marketing shells.
        "src/components/auth-redirect.tsx",
        "src/components/convert-guide-page.tsx",
        // Template studio UI chrome (logic modules under design-pad/ stay covered).
        "src/components/template-editor.tsx",
        "src/components/template-library.tsx",
        "src/components/template-shell.tsx",
        "src/design-pad/components/**",
        "src/design-pad/icons.tsx",
        "src/design-pad/store.ts",
        "src/design-pad/dropTarget.ts",
        "src/design-pad/alignmentGuides.ts",
        "src/design-pad/imageUtils.ts",
        "src/design-pad/compute-layout.ts",
        "src/design-pad/layout/**",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 69,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
