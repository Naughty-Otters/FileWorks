import {
  DEFAULT_EXTRACT_OPTIONS,
  deleteHistoryItem,
  downloadTextFile,
  extractDocument,
  fetchHealth,
  fetchHistory,
  fetchHistoryDetail,
  fetchHistoryFile,
  fetchMe,
  formatFileProviders,
  getApiBase,
  isAbortError,
  loginWithGoogle,
  logoutSession,
  refreshSession,
  upgradePlan,
  exportMarkdownFile,
} from "@/lib/api";
import { setSession } from "@/lib/auth";
import { prefetchHeavyUi } from "@/lib/prefetch";
import { prefetchMarkdownRuntime } from "@/lib/markdown-runtime";
import { loadSessionFile, saveSessionFile } from "@/lib/workspace-session";

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(headers || {}) },
  });
}

describe("api client", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches me health and history", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/me")) return jsonResponse({ user: null, plan: "anonymous", permissions: {}, quota: {} });
      if (url.endsWith("/api/health")) return jsonResponse({ status: "ok", app: "FileWorks", ocr_ready: false, ocr_engine: null, ocr_error: null });
      if (url.includes("/api/history?")) return jsonResponse({ items: [], storage_backend: "local" });
      if (url.endsWith("/api/history/1")) {
        return jsonResponse({
          id: "1",
          filename: "a.png",
          content_type: "image/png",
          size_bytes: 1,
          created_at: "2026-01-01",
          engine: "ocr",
          page_count: 1,
          format: "both",
          markdown: "# hi",
          json: {},
          pages: [],
          storage_backend: "local",
          file_url: "/api/history/1/file",
        });
      }
      if (url.endsWith("/api/history/1/file")) {
        return new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { "Content-Type": "image/png" },
        });
      }
      return new Response("nope", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const me = await fetchMe();
    expect(me.plan).toBe("anonymous");
    expect((await fetchHealth()).status).toBe("ok");
    expect((await fetchHistory()).items).toEqual([]);
    expect((await fetchHistoryDetail("1")).markdown).toBe("# hi");
    const file = await fetchHistoryFile("1", "a.png", "image/png");
    expect(file.name).toBe("a.png");
  });

  it("refreshes on 401 then retries", async () => {
    setSession("old", "refresh-token");
    let meCalls = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/refresh")) {
        return jsonResponse({ access_token: "new", refresh_token: "r2" });
      }
      if (url.endsWith("/api/me")) {
        meCalls += 1;
        if (meCalls === 1) return new Response(JSON.stringify({ detail: "expired" }), { status: 401 });
        return jsonResponse({ user: { id: "1", email: "a@b.co", name: "A", picture_url: null, plan: "basic" }, plan: "basic", permissions: {}, quota: {} });
      }
      return new Response("nope", { status: 500 });
    }));
    const me = await fetchMe();
    expect(me.plan).toBe("basic");
  });

  it("login logout extract and export", async () => {
    const click = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation(() => {
      return { click, href: "", download: "", remove: vi.fn() } as unknown as HTMLAnchorElement;
    });
    vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/auth/google")) {
        return jsonResponse({ access_token: "a", refresh_token: "r", user: null, plan: "basic", permissions: {} });
      }
      if (url.endsWith("/api/me")) {
        return jsonResponse({ user: { id: "1", email: "a@b.co", name: "A", picture_url: null, plan: "basic" }, plan: "basic", permissions: {}, quota: {} });
      }
      if (url.endsWith("/api/auth/logout")) return jsonResponse({ status: "ok" });
      if (url.endsWith("/api/extract")) {
        return jsonResponse({
          filename: "a.png",
          content_type: "image/png",
          size_bytes: 3,
          engine: "ocr",
          page_count: 1,
          format: "both",
          markdown: "# hi",
          json: {},
          pages: [],
        });
      }
      if (url.endsWith("/api/export")) {
        return new Response("hello", {
          status: 200,
          headers: { "Content-Disposition": 'attachment; filename="doc.txt"' },
        });
      }
      if (url.includes("/api/history/9")) return new Response("gone", { status: 404 });
      return new Response("nope", { status: 404 });
    }));

    const me = await loginWithGoogle("id-token");
    expect(me.user?.email).toBe("a@b.co");
    expect(await refreshSession()).toBe(false);
    await logoutSession();
    const extracted = await extractDocument(new File(["abc"], "a.png", { type: "image/png" }), "both", DEFAULT_EXTRACT_OPTIONS);
    expect(extracted.markdown).toBe("# hi");
    await exportMarkdownFile("# hi", "txt", "doc");
    expect(click).toHaveBeenCalled();
    await expect(deleteHistoryItem("9")).rejects.toThrow();
  });

  it("upgrades the plan and refreshes me", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/api/me/plan")) return jsonResponse({ access_token: "a2", refresh_token: "r2" });
        if (url.endsWith("/api/me")) {
          return jsonResponse({
            user: { id: "1", email: "a@b.co", name: "A", picture_url: null, plan: "pro" },
            plan: "pro",
            permissions: {},
            quota: {},
          });
        }
        return new Response("nope", { status: 404 });
      }),
    );
    const me = await upgradePlan("pro");
    expect(me.plan).toBe("pro");
  });

  it("parses error payloads and abort errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: { code: "quota_day" } }), { status: 403 })));
    await expect(fetchMe()).rejects.toThrow("quota_day");
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(formatFileProviders(undefined)).toContain("openai");
    expect(getApiBase()).toMatch(/http/);
    const click = vi.fn();
    vi.spyOn(document, "createElement").mockImplementation(() => {
      return { click, href: "", download: "", remove: vi.fn() } as unknown as HTMLAnchorElement;
    });
    vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);
    downloadTextFile("hi", "a.txt", "text/plain");
    expect(click).toHaveBeenCalled();
  });

  it("extracts via presign when direct upload is on", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/uploads/presign")) {
        return jsonResponse({ upload_url: "https://s3.example/put", object_key: "upload/files/anon/id/a.png" });
      }
      if (url === "https://s3.example/put") return new Response(null, { status: 200 });
      if (url.endsWith("/api/extract")) {
        return jsonResponse({
          filename: "a.png",
          content_type: "image/png",
          size_bytes: 1,
          engine: "ocr",
          page_count: 1,
          format: "both",
          markdown: "ok",
          json: {},
          pages: [],
        });
      }
      return new Response("nope", { status: 404 });
    }));
    const result = await extractDocument(new File(["x"], "a.png", { type: "image/png" }), "both", DEFAULT_EXTRACT_OPTIONS, undefined, {
      directUpload: true,
    });
    expect(result.markdown).toBe("ok");
  });
});

describe("prefetch and session file", () => {
  it("prefetches modules", async () => {
    await expect(prefetchHeavyUi()).resolves.toBeTruthy();
    await expect(prefetchMarkdownRuntime()).resolves.toBeTruthy();
  });

  it("handles missing indexedDB", async () => {
    const original = window.indexedDB;
    // @ts-expect-error test
    delete window.indexedDB;
    await saveSessionFile(new File(["x"], "a.txt"));
    expect(await loadSessionFile()).toBeNull();
    Object.defineProperty(window, "indexedDB", { value: original, configurable: true });
  });
});
