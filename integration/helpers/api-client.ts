import fs from "node:fs";
import path from "node:path";
import { APIRequestContext, expect } from "@playwright/test";
import { getEnv, requireApiKey, type FwEnv } from "./env";
import type { ConvertTarget, ParseOptionKey } from "./fixtures";

export type ConvertParams = Partial<Record<ParseOptionKey, boolean | string>> & {
  target?: ConvertTarget | string;
  download?: boolean | string;
  design?: string;
  design_fill?: "auto" | "defaults" | "none" | string;
  design_variables?: string;
  target_lang?: string;
  run_id?: string;
};

export type ConvertJson = {
  markdown?: string;
  content?: string | null;
  target?: string;
  filename?: string;
  source?: { filename?: string; pages?: number };
  applied_options?: Record<string, unknown>;
  design?: Record<string, unknown> | null;
  credits?: Record<string, unknown>;
  [key: string]: unknown;
};

function authHeaders(env: FwEnv = getEnv()): Record<string, string> {
  const key = requireApiKey(env);
  return { Authorization: `Bearer ${key}` };
}

export async function getHealth(request: APIRequestContext, env: FwEnv = getEnv()) {
  const res = await request.get(`${env.apiUrl}/api/health`);
  return res;
}

export async function getConvertCatalog(
  request: APIRequestContext,
  opts: { withKey?: boolean; env?: FwEnv } = {},
) {
  const env = opts.env ?? getEnv();
  const headers = opts.withKey ? authHeaders(env) : {};
  return request.get(`${env.apiUrl}/api/v1/convert`, { headers });
}

export async function postConvert(
  request: APIRequestContext,
  filePath: string,
  params: ConvertParams = {},
  opts: { env?: FwEnv; timeout?: number } = {},
) {
  const env = opts.env ?? getEnv();
  const timeout = opts.timeout ?? env.convertTimeoutMs;
  const filename = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);

  const multipart: Record<string, string | number | boolean | { name: string; mimeType: string; buffer: Buffer }> = {
    file: {
      name: filename,
      mimeType: mimeFor(filename),
      buffer,
    },
  };

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    multipart[key] = typeof value === "boolean" ? String(value) : value;
  }

  return request.post(`${env.apiUrl}/api/v1/convert`, {
    headers: authHeaders(env),
    multipart,
    timeout,
  });
}

function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".pdf":
      return "application/pdf";
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".txt":
      return "text/plain";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default:
      return "application/octet-stream";
  }
}

/** Assert a successful JSON convert and return the body. */
export async function expectConvertOk(
  request: APIRequestContext,
  filePath: string,
  params: ConvertParams = {},
  opts: { env?: FwEnv; timeout?: number } = {},
): Promise<ConvertJson> {
  const res = await postConvert(request, filePath, params, opts);
  const text = await res.text();
  expect(res.ok(), `convert failed ${res.status()}: ${text.slice(0, 500)}`).toBeTruthy();
  const body = JSON.parse(text) as ConvertJson;
  expect(typeof body.markdown === "string" || body.markdown === undefined).toBeTruthy();
  return body;
}
