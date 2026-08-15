import { applyMarkdownFormat } from "@/lib/markdown-format";
import { cn, formatBytes } from "@/lib/utils";
import { getClientUserId } from "@/lib/user-id";
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  scheduleTokenRefresh,
  setSession,
} from "@/lib/auth";
import {
  loadSessionFile,
  saveSessionFile,
  loadWorkspacePrefs,
  saveWorkspacePrefs,
} from "@/lib/workspace-session";
import { formatFileProviders, getApiBase, isAbortError, downloadTextFile } from "@/lib/api";
import { renderMarkdownToHtml } from "@/lib/markdown-to-html";
import { markdownToHtml } from "@/lib/markdown-runtime";
import {
  loadGoogleIdentity,
  resetGoogleIdentityLoaderForTests,
  resolveGoogleClientId,
} from "@/lib/google-gis";
import {
  convertGate,
  convertGateBody,
  convertGateTitle,
  canMoveToPlan,
  canSwitchPlan,
  planIsPurchasable,
  planRank,
  planSwitchLabel,
  usageFitsPlan,
  PLAN_CATALOG,
  PRICE_ROLES,
  formatPlanPrice,
} from "@/lib/plans";
import {
  joinLines,
  linePageCount,
  lineRangeForPages,
  LINES_PER_PAGE,
  pageStartLines,
  pageWindowStart,
  replaceLineRange,
  splitLines,
} from "@/lib/markdown-pages";

describe("utils", () => {
  it("joins class names and formats bytes", () => {
    expect(cn("a", false && "b", "c")).toContain("a");
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 MB");
  });
});

describe("markdown-format", () => {
  it("wraps and unwraps inline marks", () => {
    const bold = applyMarkdownFormat("hello", 0, 5, "bold");
    expect(bold.value).toBe("**hello**");
    const undone = applyMarkdownFormat(bold.value, 2, 7, "bold");
    expect(undone.value).toBe("hello");
    expect(applyMarkdownFormat("hi", 0, 2, "italic").value).toBe("*hi*");
    expect(applyMarkdownFormat("hi", 0, 2, "strike").value).toBe("~~hi~~");
    expect(applyMarkdownFormat("hi", 0, 2, "code").value).toBe("`hi`");
  });

  it("sets headings lists quotes and hr", () => {
    expect(applyMarkdownFormat("Title", 0, 5, "h1").value).toMatch(/^# /);
    expect(applyMarkdownFormat("# Title", 0, 7, "h1").value).toBe("Title");
    expect(applyMarkdownFormat("Title", 0, 5, "h2").value).toMatch(/^## /);
    expect(applyMarkdownFormat("Title", 0, 5, "h3").value).toMatch(/^### /);
    expect(applyMarkdownFormat("item", 0, 4, "ul").value).toMatch(/^- /);
    expect(applyMarkdownFormat("- item", 0, 6, "ul").value).toBe("item");
    expect(applyMarkdownFormat("item", 0, 4, "ol").value).toMatch(/^1\. /);
    expect(applyMarkdownFormat("q", 0, 1, "quote").value).toMatch(/^> /);
    expect(applyMarkdownFormat("x", 1, 1, "hr").value).toContain("---");
    expect(applyMarkdownFormat("hi", 0, 2, "image").value).toBe("hi");
  });

  it("inserts links and images and patches layout", () => {
    const link = applyMarkdownFormat("site", 0, 4, "link", { url: "https://a" });
    expect(link.value).toBe("[site](https://a)");
    const img = applyMarkdownFormat("hi", 2, 2, "image", { dataUrl: "data:image/png;base64,xx", alt: "logo" });
    expect(img.value).toContain("![logo]");
    const sized = applyMarkdownFormat('x ![a](u "100 left") y', 4, 4, "img-larger");
    expect(sized.value).toContain("125");
    expect(applyMarkdownFormat("![a](u)", 0, 0, "img-right").value).toContain("right");
    expect(applyMarkdownFormat("![a](u)", 0, 0, "img-left").value).toContain("left");
    expect(applyMarkdownFormat("![a](u \"80 right\")", 0, 0, "img-inline").value).toContain("80");
    expect(applyMarkdownFormat("nope", 0, 0, "img-smaller").value).toBe("nope");
  });
});

describe("auth and user id", () => {
  it("stores session tokens", () => {
    expect(getAccessToken()).toBeNull();
    setSession("acc", "ref");
    expect(getAccessToken()).toBe("acc");
    expect(getRefreshToken()).toBe("ref");
    clearSession();
    expect(getAccessToken()).toBeNull();
  });

  it("falls back when storage throws", () => {
    const spy = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getClientUserId()).toBe("anonymous");
    spy.mockRestore();
  });

  it("schedules refresh", () => {
    vi.useFakeTimers();
    const fn = vi.fn().mockResolvedValue(undefined);
    scheduleTokenRefresh(fn, 1000);
    vi.advanceTimersByTime(1000);
    expect(fn).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("workspace prefs", () => {
  it("roundtrips prefs", () => {
    const prefs = loadWorkspacePrefs();
    expect(prefs.markdownToolbar).toBe(true);
    saveWorkspacePrefs({ ...prefs, historyOpen: true, markdownToolbar: false });
    expect(loadWorkspacePrefs().historyOpen).toBe(true);
    expect(loadWorkspacePrefs().markdownToolbar).toBe(false);
  });

  it("recovers from bad json", () => {
    window.localStorage.setItem("fileworks.workspace.v1", "{not json");
    expect(loadWorkspacePrefs().view).toBe("markdown");
  });

  it("saves and loads a session file", async () => {
    const records = new Map<string, unknown>();
    const db = {
      objectStoreNames: { contains: () => true },
      close() {},
      transaction() {
        const tx: { oncomplete: null | (() => void); onerror: null | (() => void); objectStore: () => object } = {
          oncomplete: null,
          onerror: null,
          objectStore() {
            return {
              put(value: unknown, key: string) {
                records.set(key, value);
                queueMicrotask(() => tx.oncomplete?.());
              },
              delete(key: string) {
                records.delete(key);
                queueMicrotask(() => tx.oncomplete?.());
              },
              get(key: string) {
                const req: { result: unknown; onsuccess: null | (() => void); onerror: null | (() => void) } = {
                  result: records.get(key) ?? null,
                  onsuccess: null,
                  onerror: null,
                };
                queueMicrotask(() => req.onsuccess?.());
                return req;
              },
            };
          },
        };
        return tx;
      },
    };
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      value: {
        open() {
          const req: {
            result: typeof db;
            onsuccess: null | (() => void);
            onerror: null | (() => void);
            onupgradeneeded: null | (() => void);
          } = { result: db, onsuccess: null, onerror: null, onupgradeneeded: null };
          queueMicrotask(() => {
            req.onupgradeneeded?.();
            req.onsuccess?.();
          });
          return req;
        },
      },
    });
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    await saveSessionFile(file);
    const loaded = await loadSessionFile();
    expect(loaded?.name).toBe("note.txt");
    await saveSessionFile(null);
  });
});

describe("api helpers", () => {
  it("formats providers and abort errors", () => {
    expect(formatFileProviders(undefined)).toContain("openai");
    expect(formatFileProviders([{ id: "x", label: "X", default_model: "m", native_pdf: false, key_env: "K" }])).toContain("X");
    expect(getApiBase()).toMatch(/http/);
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError(new Error("nope"))).toBe(false);
  });

  it("downloads a text file", () => {
    const click = vi.fn();
    const create = vi.spyOn(document, "createElement").mockImplementation(() => {
      return { click, href: "", download: "", remove: vi.fn() } as unknown as HTMLAnchorElement;
    });
    const append = vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);
    downloadTextFile("hi", "a.txt", "text/plain");
    expect(click).toHaveBeenCalled();
    create.mockRestore();
    append.mockRestore();
  });
});

describe("markdown html", () => {
  it("renders images with size titles", async () => {
    const html = await renderMarkdownToHtml('Hello ![logo](data:image/png;base64,aa "136 right")');
    expect(html).toContain("img");
    expect(html).toContain("fw-img-right");
    const viaRuntime = await markdownToHtml("# Hi");
    expect(viaRuntime).toContain("Hi");
  });

  it("renders tables and left-aligned images", async () => {
    const html = await renderMarkdownToHtml("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(html).toContain("table");
    const left = await renderMarkdownToHtml('![logo](https://example.com/a.png "80 left")');
    expect(left).toContain("fw-img-left");
    expect(await renderMarkdownToHtml("   ")).toBe("");
  });
});

describe("google identity", () => {
  afterEach(() => {
    resetGoogleIdentityLoaderForTests();
    delete window.google;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').forEach((node) => node.remove());
  });

  it("prefers the API client id over the public env", () => {
    vi.stubEnv("NEXT_PUBLIC_GOOGLE_CLIENT_ID", "from-env");
    expect(resolveGoogleClientId(" from-api ")).toBe("from-api");
    expect(resolveGoogleClientId(null)).toBe("from-env");
  });

  it("returns a loaded GIS client", async () => {
    const google = {
      accounts: { id: { initialize: vi.fn(), renderButton: vi.fn(), prompt: vi.fn() } },
    };
    window.google = google;
    await expect(loadGoogleIdentity()).resolves.toBe(google);
  });

  it("injects the GIS script when needed", async () => {
    const google = {
      accounts: { id: { initialize: vi.fn(), renderButton: vi.fn(), prompt: vi.fn() } },
    };
    const append = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      window.google = google;
      (node as HTMLScriptElement).onload?.(new Event("load"));
      return node;
    });
    await expect(loadGoogleIdentity()).resolves.toBe(google);
    append.mockRestore();
  });

  it("rejects when the GIS script fails", async () => {
    const append = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      (node as HTMLScriptElement).onerror?.(new Event("error"));
      return node;
    });
    await expect(loadGoogleIdentity()).rejects.toThrow(/Failed to load Google Identity Services/);
    append.mockRestore();
  });

  it("rejects when the script loads without GIS", async () => {
    const append = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
      (node as HTMLScriptElement).onload?.(new Event("load"));
      return node;
    });
    await expect(loadGoogleIdentity()).rejects.toThrow(/Google Identity Services failed to load/);
    append.mockRestore();
  });

  it("reuses an already-injected GIS script tag", async () => {
    const google = {
      accounts: { id: { initialize: vi.fn(), renderButton: vi.fn(), prompt: vi.fn() } },
    };
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    document.head.appendChild(script);
    const pending = loadGoogleIdentity();
    window.google = google;
    script.dispatchEvent(new Event("load"));
    await expect(pending).resolves.toBe(google);
  });

  it("rejects when an existing GIS script errors", async () => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    document.head.appendChild(script);
    const pending = loadGoogleIdentity();
    script.dispatchEvent(new Event("error"));
    await expect(pending).rejects.toThrow(/Failed to load Google Identity Services/);
  });
});

describe("plan policy", () => {
  it("gates conversion by login quota and plan", () => {
    expect(convertGate({ signedIn: false, canExtract: false, remainingDay: null, remainingMonth: null })).toBe("login");
    expect(
      convertGate({
        signedIn: true,
        canExtract: false,
        quotaBlocked: true,
        remainingDay: 0,
        remainingMonth: null,
      }),
    ).toBe("quota_day");
    expect(
      convertGate({
        signedIn: true,
        canExtract: false,
        quotaBlocked: true,
        remainingDay: null,
        remainingMonth: 0,
      }),
    ).toBe("quota_month");
    expect(convertGate({ signedIn: true, canExtract: false, remainingDay: 1, remainingMonth: null })).toBe("plan");
    expect(convertGate({ signedIn: true, canExtract: true, remainingDay: 1, remainingMonth: 10 })).toBe("ready");
    expect(
      convertGate({
        signedIn: true,
        canExtract: true,
        remainingDay: 1,
        remainingMonth: 400,
        wantsAi: true,
        remainingAiDay: null,
        remainingAiMonth: 0,
      }),
    ).toBe("quota_ai_month");
    expect(
      convertGate({
        signedIn: true,
        canExtract: true,
        remainingDay: 1,
        remainingMonth: null,
        wantsAi: true,
        remainingAiDay: 0,
        remainingAiMonth: null,
      }),
    ).toBe("quota_ai_day");
    expect(canSwitchPlan("basic", "pro")).toBe(true);
    expect(canSwitchPlan("premium", "pro")).toBe(true);
    expect(canSwitchPlan("basic", "basic")).toBe(false);
    const lowUsage = { used_day: 1, used_month: 20, used_ai_day: 0, used_ai_month: 4 };
    const overPro = { used_day: 1, used_month: 200, used_ai_day: 0, used_ai_month: 4 };
    expect(usageFitsPlan(lowUsage, "pro")).toBe(true);
    expect(usageFitsPlan(overPro, "pro")).toBe(false);
    expect(canMoveToPlan("premium", "pro", lowUsage)).toBe(true);
    expect(canMoveToPlan("premium", "pro", overPro)).toBe(false);
    expect(canMoveToPlan("pro", "premium", overPro)).toBe(true);
    expect(planIsPurchasable("pro", { enabled: true, prices: { pro: false }, amounts: { pro: 12 } })).toBe(true);
    expect(planIsPurchasable("basic", { enabled: true, prices: { basic: false }, amounts: { basic: 0 } })).toBe(false);
    expect(planIsPurchasable("pro", { enabled: false, prices: { pro: false } })).toBe(true);
    expect(planSwitchLabel("basic", PLAN_CATALOG[1])).toBe("Upgrade to Pro");
    expect(planSwitchLabel("premium", PLAN_CATALOG[0])).toBe("Switch to Basic");
    expect(planRank("nope")).toBe(0);
    expect(PRICE_ROLES.map((item) => item.role)).toEqual(["Guest", "Basic", "Pro", "Premium"]);
    expect(PRICE_ROLES.find((item) => item.id === "pro")?.price).toBe("$12 / month");
    expect(formatPlanPrice(0)).toBe("Free");
    expect(formatPlanPrice(12)).toBe("$12 / month");
    expect(formatPlanPrice(29)).toBe("$29 / month");
  });

  it("describes each gate", () => {
    expect(convertGateTitle("login")).toMatch(/Sign in/);
    expect(convertGateTitle("quota_day")).toMatch(/Daily/);
    expect(convertGateTitle("quota_month")).toMatch(/Monthly/);
    expect(convertGateTitle("quota_ai_day")).toMatch(/AI/);
    expect(convertGateTitle("quota_ai_month")).toMatch(/AI/);
    expect(convertGateTitle("plan")).toMatch(/cannot convert/);
    expect(convertGateTitle("ready")).toMatch(/Plan rules/);
    expect(convertGateBody("login")).toMatch(/signed-in/);
    expect(convertGateBody("quota_day")).toMatch(/five conversions/);
    expect(convertGateBody("quota_month")).toMatch(/monthly/);
    expect(convertGateBody("quota_ai_day")).toMatch(/without AI/);
    expect(convertGateBody("quota_ai_month")).toMatch(/without AI/);
    expect(convertGateBody("plan")).toMatch(/does not include/);
    expect(convertGateBody("ready")).toMatch(/plan rules/);
  });
});

describe("markdown-pages", () => {
  it("windows content by line count instead of document pages", () => {
    expect(splitLines("a\nb\nc")).toEqual(["a", "b", "c"]);
    expect(joinLines(["a", "b"])).toBe("a\nb");
    expect(linePageCount(0)).toBe(0);
    expect(linePageCount(LINES_PER_PAGE)).toBe(1);
    expect(linePageCount(LINES_PER_PAGE + 1)).toBe(2);
    expect(pageWindowStart(12, 0)).toBe(0);
    expect(pageWindowStart(12, 5)).toBe(5);
    expect(pageWindowStart(7, 99)).toBe(5);
    const range = lineRangeForPages(0, LINES_PER_PAGE * 7 + 3);
    expect(range.startPage).toBe(0);
    expect(range.endPage).toBe(5);
    expect(range.lineStart).toBe(0);
    expect(range.lineEnd).toBe(LINES_PER_PAGE * 5);
    expect(range.pageCount).toBe(8);
    const next = lineRangeForPages(5, LINES_PER_PAGE * 7 + 3);
    expect(next.startPage).toBe(5);
    expect(next.endPage).toBe(8);
    expect(next.lineStart).toBe(LINES_PER_PAGE * 5);
    expect(replaceLineRange("a\nb\nc\nd", 1, 3, "B\nC")).toBe("a\nB\nC\nd");
  });

  it("windows on real page separators so a page's images stay with its text", () => {
    const page = (n: number) => `# Page ${n}\n\n![shot](data:image/jpeg;base64,AAAA)`;
    const doc = Array.from({ length: 12 }, (_, index) => page(index + 1)).join("\n\n---\n\n");
    const lines = splitLines(doc);
    expect(pageStartLines(lines)).toHaveLength(12);

    const first = lineRangeForPages(0, lines);
    expect(first.pageCount).toBe(12);
    expect(first.startPage).toBe(0);
    expect(first.endPage).toBe(5);
    const visible = joinLines(lines.slice(first.lineStart, first.lineEnd));
    expect(visible).toContain("# Page 5");
    expect(visible).not.toContain("# Page 6");
    // Every visible page keeps its own image rather than losing it to the window edge.
    expect(visible.match(/data:image/g)).toHaveLength(5);

    const second = lineRangeForPages(5, lines);
    expect(second.startPage).toBe(5);
    const later = joinLines(lines.slice(second.lineStart, second.lineEnd));
    expect(later).toContain("# Page 6");
    expect(later.match(/data:image/g)).toHaveLength(5);

    const last = lineRangeForPages(10, lines);
    expect(last.endPage).toBe(12);
    expect(joinLines(lines.slice(last.lineStart, last.lineEnd))).toContain("# Page 12");
  });

  it("treats a setext underline as a heading, not a page break", () => {
    expect(pageStartLines(splitLines("Heading\n---\n\nbody"))).toEqual([0]);
  });
});
