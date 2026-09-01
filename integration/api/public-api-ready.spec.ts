import { test, expect } from "@playwright/test";
import { getEnv } from "../helpers/env";

/**
 * @smoke — prod/staging public API must answer health + CORS for the site origin.
 */
test.describe("Public API readiness @smoke", () => {
  test("dedicated API host health returns ok", async ({ request }) => {
    const env = getEnv();
    const res = await request.get(`${env.apiUrl}/api/health`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.status).toBeTruthy();
  });

  test("CORS preflight from the site origin succeeds", async ({ request }) => {
    const env = getEnv();
    const res = await request.fetch(`${env.apiUrl}/api/health`, {
      method: "OPTIONS",
      headers: {
        Origin: env.baseUrl,
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.status()).toBeLessThan(400);
    const allow = res.headers()["access-control-allow-origin"] || "";
    expect(allow === env.baseUrl || allow === "*").toBeTruthy();
  });

  test("same-origin /api/health works when the zone Worker is published", async ({ request }) => {
    const env = getEnv();
    // Dedicated api.* hosts are always cross-origin; only site hosts need /api/*.
    if (new URL(env.baseUrl).hostname.startsWith("api.")) {
      test.skip(true, "base URL is already the API host");
    }
    const res = await request.get(`${env.baseUrl}/api/health`);
    if (res.status() === 404) {
      test.skip(true, "same-origin /api/* zone route not published on this env yet");
    }
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.status).toBeTruthy();
  });
});
