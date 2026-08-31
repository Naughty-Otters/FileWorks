import { test, expect } from "@playwright/test";
import { getEnv } from "../helpers/env";

/**
 * @smoke — admin + design-edit endpoints reject unauthenticated callers.
 * Auth-gated product APIs must not leak data to anonymous traffic.
 */
test.describe("Admin API auth @smoke", () => {
  test("GET /api/admin/overview requires auth", async ({ request }) => {
    const env = getEnv();
    const res = await request.get(`${env.apiUrl}/api/admin/overview`);
    expect([401, 403]).toContain(res.status());
  });

  test("GET /api/admin/users requires auth", async ({ request }) => {
    const env = getEnv();
    const res = await request.get(`${env.apiUrl}/api/admin/users`);
    expect([401, 403]).toContain(res.status());
  });

  test("PATCH /api/admin/users/:id requires auth", async ({ request }) => {
    const env = getEnv();
    const res = await request.patch(`${env.apiUrl}/api/admin/users/00000000-0000-0000-0000-000000000001`, {
      data: { plan: "premium" },
    });
    expect([401, 403, 404, 422]).toContain(res.status());
    expect(res.status()).not.toBe(200);
  });
});

test.describe("Design edit API auth @smoke", () => {
  test("POST /api/templates/edit requires auth", async ({ request }) => {
    const env = getEnv();
    const res = await request.post(`${env.apiUrl}/api/templates/edit`, {
      data: {
        message: "Center the title",
        document: {
          version: 2,
          pageSize: { w: 850, h: 1100 },
          root: {
            id: "root",
            kind: "box",
            label: "Document",
            children: [],
          },
          variables: [],
        },
      },
    });
    expect([401, 403]).toContain(res.status());
  });
});

test.describe("Me admin flag @smoke", () => {
  test("GET /api/me returns is_admin for anonymous callers", async ({ request }) => {
    const env = getEnv();
    const res = await request.get(`${env.apiUrl}/api/me`);
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty("is_admin");
    expect(body.is_admin).toBe(false);
    expect(body.user).toBeNull();
  });
});
