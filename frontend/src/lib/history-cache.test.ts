import { describe, expect, it, beforeEach } from "vitest";
import {
  HistoryCache,
  __historyCacheTest,
  historyCache,
} from "@/lib/history-cache";
import type { HistoryDetail, HistoryItem } from "@/lib/api";

const summary: HistoryItem = {
  id: "h1",
  filename: "old.pdf",
  content_type: "application/pdf",
  size_bytes: 12,
  created_at: "2026-01-01T12:00:00.000Z",
  engine: "anydoc",
  page_count: 1,
  storage_backend: "local",
  has_markdown: true,
  has_json: false,
};

const detail: HistoryDetail = {
  id: "h1",
  filename: "old.pdf",
  content_type: "application/pdf",
  size_bytes: 12,
  created_at: "2026-01-01T12:00:00.000Z",
  engine: "anydoc",
  page_count: 1,
  format: "both",
  markdown: "# restored",
  json: null,
  pages: [],
  storage_backend: "local",
  file_url: "/api/history/h1/file",
};

describe("HistoryCache", () => {
  beforeEach(() => {
    historyCache.clear();
  });

  it("returns a fresh entry and skips network-shaped stale matches", () => {
    const cache = new HistoryCache(2);
    cache.putDetail("h1", detail, summary);
    expect(cache.getIfFresh("h1", summary)?.detail.markdown).toBe("# restored");
    expect(
      cache.getIfFresh("h1", { ...summary, size_bytes: 99 }),
    ).toBeNull();
    expect(cache.get("h1")).toBeNull();
  });

  it("drops missing ids and changed summaries on list sync", () => {
    const cache = new HistoryCache();
    cache.putDetail("h1", detail, summary);
    cache.putDetail("h2", { ...detail, id: "h2" }, { ...summary, id: "h2" });
    cache.syncWithList([{ ...summary, size_bytes: 99 }]);
    expect(cache.get("h1")).toBeNull();
    expect(cache.get("h2")).toBeNull();
  });

  it("evicts least-recently-used entries", () => {
    const cache = new HistoryCache(2);
    cache.putDetail("a", { ...detail, id: "a" }, { ...summary, id: "a" });
    cache.putDetail("b", { ...detail, id: "b" }, { ...summary, id: "b" });
    cache.get("a");
    cache.putDetail("c", { ...detail, id: "c" }, { ...summary, id: "c" });
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")?.detail.id).toBe("a");
    expect(cache.get("c")?.detail.id).toBe("c");
  });

  it("stores and updates the source file separately", () => {
    const cache = new HistoryCache();
    cache.putDetail("h1", detail, summary, null);
    const file = new File(["x"], "old.pdf", { type: "application/pdf" });
    cache.putFile("h1", file);
    expect(cache.getIfFresh("h1", summary)?.file?.name).toBe("old.pdf");
  });

  it("builds fingerprints from summaries and details", () => {
    const fromSummary = __historyCacheTest.fingerprintFromSummary(summary);
    const fromDetail = __historyCacheTest.fingerprintFromDetail(detail);
    expect(__historyCacheTest.fingerprintsEqual(fromSummary, fromDetail)).toBe(true);
  });
});
