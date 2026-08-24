import { test, expect } from "@playwright/test";
import { getConvertCatalog } from "../helpers/api-client";
import { getEnv, requireApiKey } from "../helpers/env";
import { CONVERT_TARGETS, PARSE_OPTION_KEYS } from "../helpers/fixtures";

function optionNames(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  return options.map((o: { name?: string }) => String(o?.name || ""));
}

test.describe("Convert API catalog @smoke", () => {
  test("GET /api/v1/convert works without a key (guest catalog)", async ({ request }) => {
    const res = await getConvertCatalog(request, { withKey: false });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.input_extensions?.length || body.inputs).toBeTruthy();
    expect(body.targets).toBeTruthy();
    expect(body.options).toBeTruthy();
    expect(body.capabilities).toMatchObject({
      ai: expect.any(Boolean),
      translate: expect.any(Boolean),
    });
  });

  test("catalog exposes every parse option key", async ({ request }) => {
    const res = await getConvertCatalog(request);
    const body = await res.json();
    const names = optionNames(body.options);
    for (const key of PARSE_OPTION_KEYS) {
      expect(names, `missing option ${key}`).toContain(key);
    }
  });

  test("catalog lists expected output targets", async ({ request }) => {
    const res = await getConvertCatalog(request);
    const body = await res.json();
    const ids = (body.targets || []).map(
      (t: { id?: string } | string) => (typeof t === "string" ? t : t.id),
    );
    for (const target of CONVERT_TARGETS) {
      expect(ids).toContain(target);
    }
  });

  test("catalog lists Design starters and upload limit", async ({ request }) => {
    const res = await getConvertCatalog(request);
    const body = await res.json();
    expect(Number(body.max_upload_mb || 0)).toBeGreaterThanOrEqual(25);
    const designs = body.designs || [];
    expect(Array.isArray(designs)).toBeTruthy();
    expect(designs.length).toBeGreaterThan(0);
    const ids = designs.map((d: { id?: string }) => d.id);
    expect(ids).toContain("invoice");
  });

  test("authenticated catalog includes credits when API key set", async ({ request }) => {
    const env = getEnv();
    test.skip(!env.apiKey, "FW_API_KEY not set");
    requireApiKey(env);
    const res = await getConvertCatalog(request, { withKey: true, env });
    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.api_plan || body.credits).toBeTruthy();
  });
});
