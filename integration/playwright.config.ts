import { defineConfig, devices } from "@playwright/test";
import { getEnv } from "./helpers/env";

const env = getEnv();

/**
 * Post-deploy integration suite.
 *
 * Projects:
 *   - ui  — browser page loads + workspace option coverage
 *   - api — HTTP checks against /api (health, catalog, convert matrix)
 *
 * Env: FW_ENV=local|staging|prod (default staging). See .env.example.
 */
export default defineConfig({
  testDir: ".",
  testMatch: ["ui/**/*.spec.ts", "api/**/*.spec.ts"],
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: env.baseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    extraHTTPHeaders: {
      Accept: "application/json, text/html, */*",
    },
  },
  projects: [
    {
      name: "ui",
      testMatch: "ui/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        storageState: env.storageState,
      },
    },
    {
      name: "api",
      testMatch: "api/**/*.spec.ts",
      use: {
        // API project does not need a browser; Playwright still boots chromium
        // for request fixtures unless we leave baseURL for relative calls.
        baseURL: env.apiUrl,
      },
    },
  ],
  metadata: {
    fwEnv: env.name,
    baseUrl: env.baseUrl,
    apiUrl: env.apiUrl,
  },
});
