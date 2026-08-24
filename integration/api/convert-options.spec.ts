import { test, expect } from "@playwright/test";
import { expectConvertOk, postConvert, getConvertCatalog } from "../helpers/api-client";
import { getEnv } from "../helpers/env";
import { fixtures, PARSE_OPTION_KEYS, type ParseOptionKey } from "../helpers/fixtures";

/** Defaults that keep credit use low while still exercising each toggle. */
const OPTION_CASES: Array<{ name: string; params: Partial<Record<ParseOptionKey, boolean>> }> = [
  { name: "defaults (preserve_images + tables + regions)", params: {} },
  { name: "prefer_structure=true", params: { prefer_structure: true } },
  { name: "preserve_images=false", params: { preserve_images: false } },
  { name: "ocr_high_quality=true", params: { ocr_high_quality: true } },
  { name: "use_doc_preprocessor=true", params: { use_doc_preprocessor: true } },
  { name: "use_table_recognition=false", params: { use_table_recognition: false } },
  { name: "use_formula_recognition=true", params: { use_formula_recognition: true } },
  { name: "use_seal_recognition=true", params: { use_seal_recognition: true } },
  { name: "use_chart_recognition=true", params: { use_chart_recognition: true } },
  { name: "use_region_detection=false", params: { use_region_detection: false } },
  { name: "format_block_content=false", params: { format_block_content: false } },
];

test.describe("Convert API — parse option matrix @convert", () => {
  test.beforeEach(() => {
    test.skip(!getEnv().apiKey, "FW_API_KEY not set");
  });

  for (const { name, params } of OPTION_CASES) {
    test(`option set: ${name}`, async ({ request }) => {
      const body = await expectConvertOk(request, fixtures.txt, {
        target: "markdown",
        use_ai: false,
        target_lang: "original",
        ...params,
      });
      expect((body.markdown || "").length).toBeGreaterThan(0);
      const applied = (body.options || body.applied_options) as Record<string, unknown> | undefined;
      if (applied) {
        for (const [key, value] of Object.entries(params)) {
          expect(applied[key], key).toBe(value);
        }
      }
    });
  }

  test("use_ai respects catalog availability", async ({ request }) => {
    const catalogRes = await getConvertCatalog(request, { withKey: true });
    const catalog = await catalogRes.json();
    const aiAvailable = Boolean(catalog.capabilities?.ai);
    const useAiOpt = Array.isArray(catalog.options)
      ? catalog.options.find((o: { name?: string }) => o.name === "use_ai")
      : undefined;
    const aiAllowed = useAiOpt?.allowed !== false;

    const res = await postConvert(request, fixtures.txt, {
      target: "markdown",
      use_ai: true,
      target_lang: "original",
    });

    if (!aiAvailable || !aiAllowed) {
      // Expect a client error (option unavailable / not allowed / quota), not a crash.
      expect(res.status()).toBeGreaterThanOrEqual(400);
      expect(res.status()).toBeLessThan(500);
      return;
    }

    expect(res.ok(), await res.text()).toBeTruthy();
    const body = await res.json();
    expect(body.markdown || body.content).toBeTruthy();
  });

  test("boolean coercion accepts 1/0 and yes/no", async ({ request }) => {
    const body = await expectConvertOk(request, fixtures.txt, {
      target: "markdown",
      prefer_structure: "yes" as unknown as boolean,
      preserve_images: "0" as unknown as boolean,
      use_table_recognition: "1" as unknown as boolean,
    });
    expect(body.markdown).toBeTruthy();
  });
});

test.describe("Convert API — design fill @convert", () => {
  test.beforeEach(() => {
    test.skip(!getEnv().apiKey, "FW_API_KEY not set");
  });

  test("design=invoice with design_fill=defaults", async ({ request }) => {
    const catalogRes = await getConvertCatalog(request, { withKey: true });
    const catalog = await catalogRes.json();
    const designs: Array<{ id: string }> = catalog.designs || [];
    const invoice = designs.find((d) => d.id === "invoice") || designs[0];
    test.skip(!invoice, "No designs in catalog");

    const res = await postConvert(request, fixtures.txt, {
      target: "markdown",
      design: invoice.id,
      design_fill: "defaults",
      use_ai: false,
    });
    // Design fill may require AI credits on some plans — accept 2xx or structured 4xx.
    expect(res.status(), await res.text()).toBeLessThan(500);
    if (res.ok()) {
      const body = await res.json();
      expect(body.markdown || body.content || body.design).toBeTruthy();
    }
  });
});

test.describe("Convert API — option key inventory", () => {
  test("every PARSE_OPTION_KEYS entry is documented in catalog.options", async ({ request }) => {
    const res = await getConvertCatalog(request);
    const body = await res.json();
    const names = Array.isArray(body.options)
      ? body.options.map((o: { name?: string }) => o.name)
      : [];
    const missing = PARSE_OPTION_KEYS.filter((k) => !names.includes(k));
    expect(missing, `catalog missing: ${missing.join(", ")}`).toEqual([]);
  });
});
