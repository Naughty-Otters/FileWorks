import { test, expect } from "@playwright/test";
import { getEnv } from "../helpers/env";
import { getHealth } from "../helpers/api-client";

test.describe("API health @smoke", () => {
  test("GET /api/health returns ok", async ({ request }) => {
    const env = getEnv();
    const res = await getHealth(request, env);
    expect(res.status(), await res.text()).toBeLessThan(500);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("status");
  });

  test("GET /api/engines lists readers", async ({ request }) => {
    const env = getEnv();
    const res = await request.get(`${env.apiUrl}/api/engines`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
    expect(body.length).toBeGreaterThan(0);
  });

  test("GET /api/options returns extract defaults", async ({ request }) => {
    const env = getEnv();
    const res = await request.get(`${env.apiUrl}/api/options`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body).toBeTruthy();
  });
});
