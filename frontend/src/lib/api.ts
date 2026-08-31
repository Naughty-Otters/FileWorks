import { getClientUserId } from "@/lib/user-id";
import { resolveApiBase } from "@/lib/runtime-config";
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSession,
  type MeResponse,
} from "@/lib/auth";
import type { DesignDocument } from "@/design-pad/types";

export type { MeResponse };

export type OutputFormat = "markdown" | "json" | "both";

export type ExtractOptions = {
  use_ai: boolean;
  prefer_structure: boolean;
  preserve_images: boolean;
  ocr_high_quality: boolean;
  use_doc_preprocessor: boolean;
  use_seal_recognition: boolean;
  use_table_recognition: boolean;
  use_formula_recognition: boolean;
  use_chart_recognition: boolean;
  use_region_detection: boolean;
  format_block_content: boolean;
  target_lang: string;
};

export const DEFAULT_EXTRACT_OPTIONS: ExtractOptions = {
  use_ai: false,
  prefer_structure: false,
  preserve_images: true,
  ocr_high_quality: false,
  use_doc_preprocessor: false,
  use_seal_recognition: false,
  use_table_recognition: true,
  use_formula_recognition: false,
  use_chart_recognition: false,
  use_region_detection: true,
  format_block_content: true,
  target_lang: "",
};

export type RegionBox = {
  id: string;
  page: number;
  label: string;
  text: string;
  bbox: [number, number, number, number] | number[];
  order?: number | null;
  score?: number | null;
};

export type ImageSize = {
  width: number;
  height: number;
};

export type ExtractResponse = {
  id?: string | null;
  filename: string;
  content_type: string | null;
  size_bytes: number;
  engine: string;
  page_count: number;
  format: OutputFormat;
  markdown: string | null;
  json: unknown | null;
  pages: Array<Record<string, unknown>>;
  created_at?: string | null;
  storage_backend?: string | null;
  options?: ExtractOptions | null;
  regions?: RegionBox[];
  image_size?: ImageSize | null;
  structure?: Record<string, unknown> | null;
  design_template_id?: string | null;
  design_template_name?: string | null;
  design_html?: string | null;
  design_markdown?: string | null;
  design_context?: Record<string, unknown> | null;
  design_return_format?: "markdown" | "docx" | "pdf" | null;
};

export type LLMFileProvider = {
  id: string;
  label: string;
  default_model: string;
  native_pdf: boolean;
  key_env: string;
};

export function formatFileProviders(providers: LLMFileProvider[] | undefined): string {
  if (!providers?.length) {
    return "openai, claude, glm, openrouter, fireworks, grok, kimi";
  }
  return providers
    .map((item) => `${item.label} (${item.id}, ${item.default_model})`)
    .join("; ");
}

export type TranslateLanguage = {
  id: string;
  label: string;
};

export type HealthResponse = {
  status: string;
  app: string;
  ocr_ready: boolean;
  ocr_engine: string | null;
  ocr_error: string | null;
  llm_ready?: boolean;
  llm_provider?: string | null;
  llm_error?: string | null;
  llm_file_providers?: LLMFileProvider[];
  translate_ready?: boolean;
  translate_provider?: string | null;
  translate_error?: string | null;
  translate_languages?: TranslateLanguage[];
  storage_backend?: string | null;
  direct_upload?: boolean;
  converting?: number;
  convert_waiting?: number;
  convert_capacity?: number;
};

export type HistoryItem = {
  id: string;
  filename: string;
  content_type: string | null;
  size_bytes: number;
  created_at: string;
  engine: string | null;
  page_count: number;
  storage_backend: string;
  has_markdown: boolean;
  has_json: boolean;
  has_design?: boolean;
  design_template_id?: string | null;
  design_template_name?: string | null;
};

export type HistoryListResponse = {
  items: HistoryItem[];
  storage_backend: string;
};

export type HistoryDetail = ExtractResponse & {
  id: string;
  created_at: string;
  storage_backend: string;
  file_url: string;
  regions?: RegionBox[];
  image_size?: ImageSize | null;
};

/**
 * Browser talks to FastAPI directly for long conversion requests: Cloudflare
 * proxies cut responses off after ~100s, so a same-origin /api proxy would break
 * conversions. The endpoint is read at runtime (see runtime-config).
 */
export function getApiBase() {
  return resolveApiBase();
}

function isLocalPage(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function apiUrl(path: string, opts?: { direct?: boolean }) {
  if (!opts?.direct && isLocalPage()) return path;
  return `${resolveApiBase()}${path}`;
}

/** Carries the HTTP status so callers can tell "signed out" from "network hiccup". */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readError(res: Response, fallback: string) {
  try {
    const text = await res.text();
    if (!text) return `${fallback} — empty response from API`;
    try {
      const payload = JSON.parse(text);
      if (payload?.detail) {
        return typeof payload.detail === "string"
          ? payload.detail
          : JSON.stringify(payload.detail);
      }
    } catch {
      if (
        text.toLowerCase().includes("socket hang up") ||
        text.toLowerCase().includes("econnreset")
      ) {
        return "API connection dropped during conversion. Ensure the backend is running and retry.";
      }
      return text.slice(0, 280);
    }
  } catch {
    // ignore
  }
  return fallback;
}

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Anonymous-Id", getClientUserId());
  return headers;
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const refresh = getRefreshToken();
  if (!refresh) return false;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(apiUrl("/api/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refresh }),
        });
        if (!res.ok) {
          clearSession();
          return false;
        }
        const payload = (await res.json()) as { access_token: string; refresh_token: string };
        setSession(payload.access_token, payload.refresh_token);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

function requestBases(direct?: boolean): string[] {
  if (!direct && isLocalPage()) return [""];
  const base = resolveApiBase();
  const bases = [base];
  if (base.includes("localhost")) {
    bases.push(base.replace("localhost", "127.0.0.1"));
  }
  if (isLocalPage()) bases.push("");
  return [...new Set(bases)];
}

async function apiFetch(path: string, init?: RequestInit & { direct?: boolean }): Promise<Response> {
  const { direct, ...rest } = init || {};
  let lastNetworkError: unknown;
  for (const base of requestBases(direct)) {
    const headers = authHeaders(rest.headers);
    try {
      let res = await fetch(`${base}${path}`, { ...rest, headers });
      if (res.status === 401 && !path.startsWith("/api/auth/")) {
        const ok = await tryRefresh();
        if (ok) {
          res = await fetch(`${base}${path}`, { ...rest, headers: authHeaders(rest.headers) });
        }
      }
      return res;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw err;
      }
      if (err instanceof Error && err.name === "AbortError") {
        throw err;
      }
      lastNetworkError = err;
    }
  }
  void lastNetworkError;
  throw new Error(unreachableMessage(path));
}

/** fetch() hides CORS and crash details, so name the likely cause per environment. */
export function unreachableMessage(path: string, local = isLocalPage()): string {
  const base = resolveApiBase();
  if (local) {
    return `Cannot reach API at ${base}. Start the backend (port 8000) and retry.`;
  }
  return (
    `Request to ${base}${path} was blocked. The server is usually up: this is a CORS ` +
    `rejection or a server error that never reached the CORS layer. Check the browser ` +
    `console for the exact reason and the API logs for a crash.`
  );
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await apiFetch("/api/me", { cache: "no-store" });
  if (!res.ok) {
    throw new ApiError(res.status, await readError(res, `Session check failed (${res.status})`));
  }
  return res.json();
}

export async function loginWithGoogle(idToken: string): Promise<MeResponse> {
  const res = await fetch(apiUrl("/api/auth/google"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, `Google sign-in failed (${res.status})`));
  }
  const payload = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    user: MeResponse["user"];
    plan: string;
    permissions: Record<string, boolean>;
  };
  setSession(payload.access_token, payload.refresh_token);
  // The session is already established. A failing profile fetch must not surface
  // as a failed login, or the caller never navigates away from /login.
  try {
    return await fetchMe();
  } catch {
    return sessionFromLogin(payload);
  }
}

const EMPTY_QUOTA: MeResponse["quota"] = {
  used_day: 0,
  used_month: 0,
  limit_day: null,
  limit_month: null,
  remaining_day: null,
  remaining_month: null,
  used_ai_day: 0,
  used_ai_month: 0,
  limit_ai_day: null,
  limit_ai_month: null,
  remaining_ai_day: null,
  remaining_ai_month: null,
};

function sessionFromLogin(payload: {
  user: MeResponse["user"];
  plan: string;
  permissions: Record<string, boolean>;
}): MeResponse {
  return {
    user: payload.user,
    plan: payload.plan,
    permissions: payload.permissions,
    quota: { ...EMPTY_QUOTA },
    google_client_id: null,
  };
}

export async function upgradePlan(plan: string): Promise<MeResponse> {
  const res = await apiFetch("/api/me/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, `Plan change failed (${res.status})`));
  }
  const payload = (await res.json()) as { access_token: string; refresh_token: string };
  setSession(payload.access_token, payload.refresh_token);
  return fetchMe();
}

export type BillingCatalog = {
  enabled: boolean;
  currency: string;
  yearly_discount?: number;
  amounts: Record<string, number>;
  yearly_amounts?: Record<string, number>;
  prices: Record<string, boolean>;
  yearly_prices?: Record<string, boolean>;
  api?: {
    amounts: Record<string, number>;
    yearly_amounts?: Record<string, number>;
    prices: Record<string, boolean>;
    yearly_prices?: Record<string, boolean>;
  };
};

export type ApiKeyPublic = {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  created_at: string | null;
  last_used_at: string | null;
};

export type CreatedApiKey = ApiKeyPublic & { token: string };

export async function fetchBillingCatalog(): Promise<BillingCatalog> {
  const res = await apiFetch("/api/billing/catalog", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await readError(res, `Billing catalog failed (${res.status})`));
  }
  return (await res.json()) as BillingCatalog;
}

export async function startCheckout(
  plan: string,
  returnTo = "/profile",
  interval: "month" | "year" = "month",
): Promise<{ url: string | null; updated: boolean; plan?: string }> {
  const res = await apiFetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, return_to: returnTo, interval }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, `Checkout failed (${res.status})`));
  }
  return (await res.json()) as { url: string | null; updated: boolean; plan?: string };
}

export async function confirmCheckout(sessionId: string): Promise<{ plan: string | null }> {
  const res = await apiFetch("/api/billing/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, `Checkout confirm failed (${res.status})`));
  }
  return (await res.json()) as { plan: string | null };
}

export async function openBillingPortal(product = "workspace"): Promise<{ url: string }> {
  const query = product === "api" ? "?product=api" : "";
  const res = await apiFetch(`/api/billing/portal${query}`, { method: "POST" });
  if (!res.ok) {
    throw new Error(await readError(res, `Billing portal failed (${res.status})`));
  }
  return (await res.json()) as { url: string };
}

export async function syncBilling(): Promise<MeResponse> {
  const res = await apiFetch("/api/billing/sync", { method: "POST" });
  if (!res.ok) {
    throw new Error(await readError(res, `Billing sync failed (${res.status})`));
  }
  return fetchMe();
}

export async function upgradeApiPlan(plan: string): Promise<MeResponse> {
  const res = await apiFetch("/api/me/api-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, `API plan change failed (${res.status})`));
  }
  return (await res.json()) as MeResponse;
}

export async function listApiKeys(): Promise<ApiKeyPublic[]> {
  const res = await apiFetch("/api/keys", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await readError(res, `API keys failed (${res.status})`));
  }
  return (await res.json()) as ApiKeyPublic[];
}

export async function createApiKey(name?: string): Promise<CreatedApiKey> {
  const res = await apiFetch("/api/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name || undefined }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, `Create API key failed (${res.status})`));
  }
  return (await res.json()) as CreatedApiKey;
}

export async function revokeApiKey(id: string): Promise<void> {
  const res = await apiFetch(`/api/keys/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readError(res, `Revoke API key failed (${res.status})`));
  }
}

export async function logoutSession(): Promise<void> {
  const refresh = getRefreshToken();
  if (refresh) {
    await fetch(apiUrl("/api/auth/logout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
    }).catch(() => undefined);
  }
  clearSession();
}

export async function refreshSession(): Promise<boolean> {
  return tryRefresh();
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await apiFetch("/api/health", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await readError(res, `Health check failed (${res.status})`));
  }
  return res.json();
}

export function newRunId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ? random.replace(/-/g, "") : `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

/**
 * Ask the server to stop a run. Aborting the fetch alone is not enough: behind a
 * proxy or container port forward the disconnect may never reach the backend, and
 * the abandoned run keeps holding the conversion slot.
 */
export async function cancelExtract(runId: string): Promise<boolean> {
  const body = new FormData();
  body.append("run_id", runId);
  try {
    const res = await apiFetch("/api/extract/cancel", { direct: true, method: "POST", body });
    if (!res.ok) return false;
    const data = (await res.json()) as { stopped?: boolean };
    return data.stopped === true;
  } catch {
    return false;
  }
}

export async function extractDocument(
  file: File,
  outputFormat: OutputFormat = "both",
  options: ExtractOptions = DEFAULT_EXTRACT_OPTIONS,
  signal?: AbortSignal,
  extras?: { directUpload?: boolean; runId?: string },
): Promise<ExtractResponse> {
  const useDirect =
    extras?.directUpload === true || process.env.NEXT_PUBLIC_DIRECT_UPLOAD === "1";

  const body = new FormData();
  body.append("output_format", outputFormat);
  (Object.keys(options) as Array<keyof ExtractOptions>).forEach((key) => {
    body.append(key, String(options[key]));
  });
  if (extras?.runId) body.append("run_id", extras.runId);

  if (useDirect) {
    const presignRes = await apiFetch("/api/uploads/presign", {
      direct: true,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        user_id: getClientUserId(),
      }),
      signal,
    });
    if (!presignRes.ok) {
      throw new Error(await readError(presignRes, `Upload handshake failed (${presignRes.status})`));
    }
    const presign = (await presignRes.json()) as {
      upload_url: string;
      object_key: string;
      headers?: Record<string, string>;
    };
    const putRes = await fetch(presign.upload_url, {
      method: "PUT",
      body: file,
      headers: presign.headers || { "Content-Type": file.type || "application/octet-stream" },
      signal,
    });
    if (!putRes.ok) {
      throw new Error(`S3 upload failed (${putRes.status})`);
    }
    body.append("s3_key", presign.object_key);
    body.append("filename", file.name);
    if (file.type) body.append("content_type", file.type);
  } else {
    body.append("file", file);
  }

  const res = await apiFetch("/api/extract", {
    direct: true,
    method: "POST",
    body,
    signal,
  });

  if (!res.ok) {
    throw new Error(await readError(res, `Extraction failed (${res.status})`));
  }

  return res.json();
}

export function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export async function fetchHistory(limit = 100): Promise<HistoryListResponse> {
  const res = await apiFetch(`/api/history?limit=${limit}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await readError(res, `Failed to load history (${res.status})`));
  }
  return res.json();
}

export async function fetchHistoryDetail(id: string): Promise<HistoryDetail> {
  const res = await apiFetch(`/api/history/${id}`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await readError(res, `Failed to load document (${res.status})`));
  }
  return res.json();
}

export async function patchHistoryDesign(
  id: string,
  input: {
    design_template_id: string;
    design_template_name?: string | null;
    design_html: string;
    design_markdown?: string | null;
    design_context?: Record<string, unknown> | null;
    design_return_format?: "markdown" | "docx" | "pdf" | null;
  },
): Promise<HistoryDetail> {
  const res = await apiFetch(`/api/history/${encodeURIComponent(id)}/design`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await readError(res, `Failed to save design output (${res.status})`));
  }
  return res.json();
}

export async function fetchHistoryFile(
  id: string,
  filename: string,
  contentType: string | null,
): Promise<File> {
  const res = await apiFetch(`/api/history/${id}/file-url`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await readError(res, `Failed to load file (${res.status})`));
  }
  const { url } = (await res.json()) as { url: string };
  // An absolute URL is presigned S3, so fetch it bare. Sending our Authorization
  // header would force a preflight, and following the API's redirect instead
  // would make the browser send Origin: null, which S3 rejects.
  const fileRes = /^https?:\/\//.test(url)
    ? await fetch(url, { cache: "no-store" })
    : await apiFetch(url, { cache: "no-store" });
  if (!fileRes.ok) {
    throw new Error(await readError(fileRes, `Failed to load file (${fileRes.status})`));
  }
  const blob = await fileRes.blob();
  const type = contentType || blob.type || "application/octet-stream";
  return new File([blob], filename, { type, lastModified: Date.now() });
}

export async function deleteHistoryItem(id: string): Promise<void> {
  const res = await apiFetch(`/api/history/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readError(res, `Failed to delete document (${res.status})`));
  }
}

export type DownloadFormat = "markdown" | "txt" | "html" | "json" | "docx";

export async function exportMarkdownFile(
  markdown: string,
  format: DownloadFormat,
  filename?: string,
  opts?: { documentId?: string | null; structure?: Record<string, unknown> | null },
): Promise<void> {
  const res = await apiFetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      markdown,
      format,
      filename,
      document_id: opts?.documentId || undefined,
      structure: opts?.structure || undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(await readError(res, `Export failed (${res.status})`));
  }
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const downloadName = match?.[1] || `document.${format === "markdown" ? "md" : format}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = downloadName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Client-side fallback exporters (no round-trip) for offline-friendly downloads. */
export function downloadTextFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export type TemplateRecord = {
  id: string;
  name: string;
  document: DesignDocument;
  description?: string | null;
  page_label?: string | null;
  variable_count?: number;
  is_static?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

function normalizeTemplate(payload: unknown): TemplateRecord {
  const source = (payload && typeof payload === "object" && "template" in payload
    ? (payload as { template: unknown }).template
    : payload) as Record<string, unknown>;
  const rawDocument = source.document ?? source.design_document ?? source.content;
  const document = typeof rawDocument === "string" ? JSON.parse(rawDocument) : rawDocument;
  const variableCount =
    typeof source.variable_count === "number"
      ? source.variable_count
      : Array.isArray((document as DesignDocument | null)?.variables)
        ? (document as DesignDocument).variables.length
        : 0;
  return {
    id: String(source.id),
    name: String(source.name || source.title || "Untitled design"),
    document: (document || {
      version: 2,
      pageSize: { w: 850, h: 1100 },
      root: {
        id: "root",
        kind: "box",
        label: "Document",
        x: 0,
        y: 0,
        w: 850,
        h: 1100,
        style: {},
        layout: null,
        children: [],
      },
      variables: [],
    }) as DesignDocument,
    description: typeof source.description === "string" ? source.description : null,
    page_label: typeof source.page_label === "string" ? source.page_label : null,
    variable_count: variableCount,
    is_static: typeof source.is_static === "boolean" ? source.is_static : undefined,
    created_at: typeof source.created_at === "string" ? source.created_at : null,
    updated_at: typeof source.updated_at === "string" ? source.updated_at : null,
  };
}

export async function fetchTemplates(): Promise<TemplateRecord[]> {
  const res = await apiFetch("/api/templates", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, `Failed to load templates (${res.status})`));
  const payload = await res.json();
  const items = Array.isArray(payload) ? payload : payload?.items ?? payload?.templates ?? [];
  return items.map(normalizeTemplate);
}

export async function createTemplate(input: {
  name: string;
  document: DesignDocument;
  description?: string | null;
  page_label?: string | null;
}): Promise<TemplateRecord> {
  const res = await apiFetch("/api/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, `Failed to create template (${res.status})`));
  return normalizeTemplate(await res.json());
}

export async function fetchTemplate(id: string): Promise<TemplateRecord> {
  const res = await apiFetch(`/api/templates/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, `Failed to load template (${res.status})`));
  return normalizeTemplate(await res.json());
}

export async function updateTemplate(
  id: string,
  input: { name: string; document: DesignDocument },
): Promise<TemplateRecord> {
  const res = await apiFetch(`/api/templates/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await readError(res, `Failed to save template (${res.status})`));
  return normalizeTemplate(await res.json());
}

export async function deleteTemplate(id: string): Promise<void> {
  const res = await apiFetch(`/api/templates/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await readError(res, `Failed to delete template (${res.status})`));
}

export type TemplateRenderResponse = {
  html: string;
  markdown?: string;
  filename?: string;
  docx?: Blob;
  pdf?: Blob;
  context?: Record<string, unknown>;
  fillMode?: string | null;
  warnings?: string[];
};

async function parseTemplateRenderResponse(
  res: Response,
  format: "html" | "docx" | "pdf" | "markdown" | undefined,
): Promise<TemplateRenderResponse> {
  const contentType = res.headers.get("Content-Type") || "";
  const fillMode = res.headers.get("X-Template-Fill");
  if (contentType.includes("application/json")) {
    const payload = await res.json();
    return {
      html: payload.html ?? payload.rendered_html ?? "",
      markdown: payload.markdown,
      filename: payload.filename,
      context: payload.context,
      fillMode: payload.fill_mode ?? fillMode,
      warnings: payload.warnings,
    };
  }
  if (format === "docx" || contentType.includes("wordprocessingml")) {
    return { html: "", docx: await res.blob(), fillMode };
  }
  if (format === "pdf" || contentType.includes("application/pdf")) {
    return { html: "", pdf: await res.blob(), fillMode };
  }
  if (format === "markdown" || contentType.includes("text/markdown")) {
    return { html: "", markdown: await res.text(), fillMode };
  }
  return { html: await res.text(), fillMode };
}

export async function renderTemplate(
  id: string,
  input: {
    markdown: string;
    variables?: Record<string, unknown>;
    format?: "html" | "docx" | "pdf" | "markdown";
    fill?: "auto" | "defaults" | "none";
    envelope?: boolean;
  },
): Promise<TemplateRenderResponse> {
  const envelope = input.envelope ?? (input.format === "html" || !input.format);
  const res = await apiFetch(`/api/templates/${encodeURIComponent(id)}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, envelope }),
  });
  if (!res.ok) throw new Error(await readError(res, `Template render failed (${res.status})`));
  return parseTemplateRenderResponse(res, input.format);
}

export type StarterVariable = {
  name: string;
  label: string;
  type: string;
  sampleValue?: unknown;
  sample_value?: unknown;
  itemSchema?: Array<Record<string, unknown>>;
  item_schema?: Array<Record<string, unknown>>;
};

export type StarterSummary = {
  id: string;
  name: string;
  description: string;
  category: string;
  variable_count: number;
  variables: StarterVariable[];
  page_size?: { w: number; h: number } | null;
};

export type StarterListResponse = {
  categories: Array<{ id: string; label: string; blurb?: string }>;
  items: StarterSummary[];
};

/** Built-in starter catalog (variable schemas) for API / workspace clients. */
export async function fetchStarters(): Promise<StarterListResponse> {
  const res = await apiFetch("/api/templates/starters", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, `Failed to load starters (${res.status})`));
  return (await res.json()) as StarterListResponse;
}

export async function fetchStarter(id: string): Promise<StarterSummary & { document: DesignDocument }> {
  const res = await apiFetch(`/api/templates/starters/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, `Failed to load starter (${res.status})`));
  return (await res.json()) as StarterSummary & { document: DesignDocument };
}

/** Render a built-in starter by id with explicit ``variables`` (or AI fill). */
export async function renderStarter(
  starterId: string,
  input: {
    markdown?: string;
    variables?: Record<string, unknown>;
    format?: "html" | "docx" | "pdf" | "markdown";
    fill?: "auto" | "defaults" | "none";
    envelope?: boolean;
  } = {},
): Promise<TemplateRenderResponse> {
  const envelope = input.envelope ?? (input.format === "html" || !input.format);
  const res = await apiFetch(`/api/templates/starters/${encodeURIComponent(starterId)}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      markdown: input.markdown ?? "",
      variables: input.variables ?? {},
      format: input.format ?? "html",
      fill: input.fill ?? (input.markdown ? "auto" : "defaults"),
      envelope,
    }),
  });
  if (!res.ok) throw new Error(await readError(res, `Starter render failed (${res.status})`));
  return parseTemplateRenderResponse(res, input.format);
}

export async function editDesign(input: {
  message: string;
  document: DesignDocument;
  selection_id?: string | null;
  conversation?: { role: "user" | "assistant"; content: string }[];
}): Promise<import("@/design-pad/ops/schema").DesignEditResponse> {
  const res = await apiFetch("/api/templates/edit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: input.message,
      document: input.document,
      selection_id: input.selection_id ?? null,
      conversation: input.conversation ?? [],
      mode: "plan_and_apply",
    }),
  });
  if (!res.ok) throw new Error(await readError(res, `Design edit failed (${res.status})`));
  return res.json();
}

export type AdminUserSummary = {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  api_plan: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_api_subscription_id: string | null;
  history_indexed: boolean;
  created_at: string | null;
  updated_at: string | null;
  usage_events: number;
  api_keys: number;
  history_documents: number;
  templates: number;
};

export type AdminUserDetail = AdminUserSummary & {
  picture_url: string | null;
  google_sub: string | null;
  quota: MeResponse["quota"];
  api_quota: NonNullable<MeResponse["api_quota"]>;
};

export type AdminOverview = {
  users: number;
  usage_events: number;
  api_keys: number;
  history_documents: number;
  templates: number;
  plans: Record<string, number>;
  api_plans: Record<string, number>;
};

export type AdminPlanOptions = {
  workspace_plans: { id: string; label: string }[];
  api_plans: { id: string; label: string }[];
};

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const res = await apiFetch("/api/admin/overview", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, `Admin overview failed (${res.status})`));
  return res.json();
}

export async function fetchAdminPlans(): Promise<AdminPlanOptions> {
  const res = await apiFetch("/api/admin/plans", { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, `Admin plans failed (${res.status})`));
  return res.json();
}

export async function fetchAdminUsers(input?: {
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: AdminUserSummary[]; total: number; limit: number; offset: number }> {
  const params = new URLSearchParams();
  if (input?.q) params.set("q", input.q);
  if (input?.limit != null) params.set("limit", String(input.limit));
  if (input?.offset != null) params.set("offset", String(input.offset));
  const query = params.toString();
  const res = await apiFetch(`/api/admin/users${query ? `?${query}` : ""}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, `Admin users failed (${res.status})`));
  return res.json();
}

export async function fetchAdminUser(id: string): Promise<AdminUserDetail> {
  const res = await apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await readError(res, `Admin user failed (${res.status})`));
  return res.json();
}

export async function updateAdminUser(
  id: string,
  patch: { plan?: string; api_plan?: string },
): Promise<AdminUserDetail> {
  const res = await apiFetch(`/api/admin/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(await readError(res, `Admin update failed (${res.status})`));
  return res.json();
}
