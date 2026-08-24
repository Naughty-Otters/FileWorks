/**
 * Session cache for history detail + source file.
 *
 * List rows stay DB summaries. Opening a document stores the heavy payload so
 * re-clicks skip the network. Entries go stale when the list summary changes,
 * the id disappears, the user signs out, or the item is deleted.
 */

import type { ExtractResponse, HistoryDetail, HistoryItem } from "@/lib/api";

export type HistorySummaryFingerprint = {
  created_at: string;
  size_bytes: number;
  page_count: number;
  engine: string | null;
  has_markdown: boolean;
  has_json: boolean;
  has_design: boolean;
};

export type HistoryCacheEntry = {
  detail: HistoryDetail;
  file: File | null;
  fingerprint: HistorySummaryFingerprint;
  fetchedAt: number;
};

const DEFAULT_CAPACITY = 10;

function fingerprintFromSummary(item: HistoryItem): HistorySummaryFingerprint {
  return {
    created_at: item.created_at,
    size_bytes: item.size_bytes,
    page_count: item.page_count,
    engine: item.engine,
    has_markdown: item.has_markdown,
    has_json: item.has_json,
    has_design: Boolean(item.has_design),
  };
}

function fingerprintFromDetail(detail: HistoryDetail | ExtractResponse): HistorySummaryFingerprint {
  return {
    created_at: detail.created_at || "",
    size_bytes: detail.size_bytes,
    page_count: detail.page_count,
    engine: detail.engine || null,
    has_markdown: Boolean(detail.markdown),
    has_json: detail.json != null,
    has_design: Boolean(detail.design_html && detail.design_template_id),
  };
}

function fingerprintsEqual(a: HistorySummaryFingerprint, b: HistorySummaryFingerprint): boolean {
  return (
    a.created_at === b.created_at &&
    a.size_bytes === b.size_bytes &&
    a.page_count === b.page_count &&
    a.engine === b.engine &&
    a.has_markdown === b.has_markdown &&
    a.has_json === b.has_json &&
    a.has_design === b.has_design
  );
}

function toHistoryDetail(data: HistoryDetail | ExtractResponse, id: string): HistoryDetail {
  if ("file_url" in data && data.id) {
    return data as HistoryDetail;
  }
  return {
    id,
    filename: data.filename,
    content_type: data.content_type,
    size_bytes: data.size_bytes,
    engine: data.engine,
    page_count: data.page_count,
    format: data.format,
    markdown: data.markdown,
    json: data.json,
    pages: data.pages,
    created_at: data.created_at || new Date().toISOString(),
    storage_backend: data.storage_backend || "unknown",
    file_url: `/api/history/${id}/file`,
    regions: data.regions || [],
    image_size: data.image_size || null,
    structure: data.structure ?? null,
    options: data.options ?? null,
    design_template_id: data.design_template_id ?? null,
    design_template_name: data.design_template_name ?? null,
    design_html: data.design_html ?? null,
    design_markdown: data.design_markdown ?? null,
    design_context: data.design_context ?? null,
    design_return_format: data.design_return_format ?? null,
  };
}

export class HistoryCache {
  private readonly capacity: number;
  private readonly entries = new Map<string, HistoryCacheEntry>();

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, capacity);
  }

  clear(): void {
    this.entries.clear();
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  get(id: string): HistoryCacheEntry | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    // Refresh LRU order
    this.entries.delete(id);
    this.entries.set(id, entry);
    return entry;
  }

  /** Return a usable entry only when it still matches the list summary. */
  getIfFresh(id: string, summary: HistoryItem | null | undefined): HistoryCacheEntry | null {
    const entry = this.get(id);
    if (!entry) return null;
    if (!summary) {
      // No list row — keep entry until syncHistoryList drops it.
      return entry;
    }
    if (!fingerprintsEqual(entry.fingerprint, fingerprintFromSummary(summary))) {
      this.entries.delete(id);
      return null;
    }
    return entry;
  }

  putDetail(
    id: string,
    detail: HistoryDetail | ExtractResponse,
    summary?: HistoryItem | null,
    file?: File | null,
  ): HistoryCacheEntry {
    const normalized = toHistoryDetail(detail, id);
    const fingerprint = summary
      ? fingerprintFromSummary(summary)
      : fingerprintFromDetail(normalized);
    const existing = this.entries.get(id);
    const entry: HistoryCacheEntry = {
      detail: normalized,
      file: file === undefined ? existing?.file ?? null : file,
      fingerprint,
      fetchedAt: Date.now(),
    };
    this.entries.delete(id);
    this.entries.set(id, entry);
    this.trim();
    return entry;
  }

  putFile(id: string, file: File): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.file = file;
    this.entries.delete(id);
    this.entries.set(id, entry);
  }

  /**
   * Drop ids missing from the list. Drop entries whose summary fingerprint
   * no longer matches (reprocessed / replaced document).
   */
  syncWithList(items: HistoryItem[]): void {
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const id of [...this.entries.keys()]) {
      const summary = byId.get(id);
      if (!summary) {
        this.entries.delete(id);
        continue;
      }
      const entry = this.entries.get(id);
      if (entry && !fingerprintsEqual(entry.fingerprint, fingerprintFromSummary(summary))) {
        this.entries.delete(id);
      }
    }
  }

  size(): number {
    return this.entries.size;
  }

  private trim(): void {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}

/** Shared session cache for the workspace. */
export const historyCache = new HistoryCache();

export const __historyCacheTest = {
  fingerprintFromSummary,
  fingerprintFromDetail,
  fingerprintsEqual,
  toHistoryDetail,
};
