import { getClientUserId } from "@/lib/user-id";
import { resolveApiBase } from "@/lib/runtime-config";
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  setSession,
  type MeResponse,
} from "@/lib/auth";

export type { MeResponse };

export type OutputFormat = "markdown" | "json" | "both";

export type ExtractOptions = {
  use_ai: boolean;
  prefer_structure: boolean;
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
  amounts: Record<string, number>;
  prices: Record<string, boolean>;
  api?: {
    amounts: Record<string, number>;
    prices: Record<string, boolean>;
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
): Promise<{ url: string | null; updated: boolean; plan?: string }> {
  const res = await apiFetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, return_to: returnTo }),
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

export type DownloadFormat = "markdown" | "txt" | "html" | "json" | "docx" | "png" | "jpeg";

export async function exportMarkdownFile(
  markdown: string,
  format: DownloadFormat,
  filename?: string,
): Promise<void> {
  const res = await apiFetch("/api/export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown, format, filename }),
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
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
