import { test, expect } from "@playwright/test";
import { expectConvertOk, postConvert } from "../helpers/api-client";
import { getEnv } from "../helpers/env";
import { CONVERT_TARGETS, fixtures } from "../helpers/fixtures";

test.describe("Convert API — auth and validation", () => {
  test("POST without API key is rejected", async ({ request }) => {
    const env = getEnv();
    const res = await request.post(`${env.apiUrl}/api/v1/convert`, {
      multipart: {
        file: {
          name: "sample.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("hello"),
        },
        target: "markdown",
      },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("POST with empty file is rejected", async ({ request }) => {
    const env = getEnv();
    test.skip(!env.apiKey, "FW_API_KEY not set");
    const res = await request.post(`${env.apiUrl}/api/v1/convert`, {
      headers: { Authorization: `Bearer ${env.apiKey}` },
      multipart: {
        file: {
          name: "empty.txt",
          mimeType: "text/plain",
          buffer: Buffer.alloc(0),
        },
      },
    });
    expect(res.status()).toBe(400);
  });

  test("POST with unsupported extension is rejected", async ({ request }) => {
    const env = getEnv();
    test.skip(!env.apiKey, "FW_API_KEY not set");
    const res = await request.post(`${env.apiUrl}/api/v1/convert`, {
      headers: { Authorization: `Bearer ${env.apiKey}` },
      multipart: {
        file: {
          name: "nope.exe",
          mimeType: "application/octet-stream",
          buffer: Buffer.from("MZ"),
        },
      },
    });
    expect([400, 415]).toContain(res.status());
  });
});

test.describe("Convert API — targets matrix @convert", () => {
  test.beforeEach(() => {
    test.skip(!getEnv().apiKey, "FW_API_KEY not set");
  });

  for (const target of CONVERT_TARGETS) {
    test(`target=${target} from sample.txt`, async ({ request }) => {
      const body = await expectConvertOk(request, fixtures.txt, {
        target,
        use_ai: false,
        target_lang: "original",
      });
      if (target === "markdown" || target === "txt" || target === "html" || target === "json") {
        expect(body.markdown || body.content).toBeTruthy();
      }
      if (target === "docx") {
        // JSON wrapper may base64-encode content.
        expect(body.content || body.markdown).toBeTruthy();
      }
    });
  }

  test("download=true returns an attachment for markdown", async ({ request }) => {
    const res = await postConvert(request, fixtures.md, {
      target: "markdown",
      download: true,
      use_ai: false,
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const disposition = res.headers()["content-disposition"] || "";
    expect(disposition.toLowerCase()).toContain("attachment");
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });
});

test.describe("Convert API — input types @convert", () => {
  test.beforeEach(() => {
    test.skip(!getEnv().apiKey, "FW_API_KEY not set");
  });

  test("converts sample.md", async ({ request }) => {
    const body = await expectConvertOk(request, fixtures.md, { target: "markdown" });
    expect(body.markdown || "").toMatch(/Sample|fixture|item/i);
  });

  test("converts sample.pdf", async ({ request }) => {
    const body = await expectConvertOk(request, fixtures.pdf, {
      target: "markdown",
      prefer_structure: false,
      use_ai: false,
    });
    expect((body.markdown || body.content || "").length).toBeGreaterThan(0);
  });

  test("converts sample.png (may be short / OCR)", async ({ request }) => {
    // Tiny 1x1 PNG — expect success or a structured empty/OCR result, not 5xx.
    const res = await postConvert(request, fixtures.png, {
      target: "markdown",
      use_ai: false,
    });
    expect(res.status(), await res.text()).toBeLessThan(500);
  });
});
