import { getClientUserId } from "@/lib/user-id";
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
 * Browser talks to FastAPI directly for long conversion requests.
 * NEXT_PUBLIC_API_URL defaults to local backend (avoids Next.js proxy timeouts).
 */
const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000").replace(
  /\/$/,
  "",
);

export function getApiBase() {
  return API_BASE;
}

function apiUrl(path: string) {
  return `${API_BASE}${path}`;
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

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = authHeaders(init?.headers);
  try {
    let res = await fetch(apiUrl(path), { ...init, headers });
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      const ok = await tryRefresh();
      if (ok) {
        res = await fetch(apiUrl(path), { ...init, headers: authHeaders(init?.headers) });
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
    throw new Error(
      `Cannot reach API at ${API_BASE}. Start the backend (port 8000) and retry.`,
    );
  }
}

export async function fetchMe(): Promise<MeResponse> {
  const res = await apiFetch("/api/me", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await readError(res, `Session check failed (${res.status})`));
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
  return fetchMe();
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

export async function extractDocument(
  file: File,
  outputFormat: OutputFormat = "both",
  options: ExtractOptions = DEFAULT_EXTRACT_OPTIONS,
  signal?: AbortSignal,
  extras?: { directUpload?: boolean },
): Promise<ExtractResponse> {
  const useDirect =
    extras?.directUpload === true || process.env.NEXT_PUBLIC_DIRECT_UPLOAD === "1";

  const body = new FormData();
  body.append("output_format", outputFormat);
  (Object.keys(options) as Array<keyof ExtractOptions>).forEach((key) => {
    body.append(key, String(options[key]));
  });

  if (useDirect) {
    const presignRes = await apiFetch("/api/uploads/presign", {
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
  const res = await apiFetch(`/api/history/${id}/file`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(await readError(res, `Failed to load file (${res.status})`));
  }
  const blob = await res.blob();
  const type = contentType || blob.type || "application/octet-stream";
  return new File([blob], filename, { type, lastModified: Date.now() });
}

export async function deleteHistoryItem(id: string): Promise<void> {
  const res = await apiFetch(`/api/history/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error(await readError(res, `Failed to delete document (${res.status})`));
  }
}

export type DownloadFormat = "markdown" | "txt" | "html" | "json";

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
