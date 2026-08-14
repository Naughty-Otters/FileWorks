"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Clock3, FileImage, PanelLeftClose, WifiOff } from "lucide-react";
import {
  deleteHistoryItem,
  extractDocument,
  fetchHealth,
  fetchHistory,
  fetchHistoryDetail,
  fetchHistoryFile,
  fetchMe,
  isAbortError,
  refreshSession,
  DEFAULT_EXTRACT_OPTIONS,
  type ExtractOptions,
  type ExtractResponse,
  type HealthResponse,
  type HistoryItem,
} from "@/lib/api";
import { AuthBar } from "@/components/auth-bar";
import { ConvertControls } from "@/components/convert-controls";
import { ResultPanel } from "@/components/result-panel";
import { ThemeToggle } from "@/components/theme-toggle";
import { UploadPanel } from "@/components/upload-panel";
import { prefetchHeavyUi } from "@/lib/prefetch";
import { scheduleTokenRefresh, type MeResponse } from "@/lib/auth";
import { aiQuotaLeft } from "@/lib/plans";
import { cn } from "@/lib/utils";
import {
  loadSessionFile,
  loadWorkspacePrefs,
  saveSessionFile,
  saveWorkspacePrefs,
  type MarkdownMode,
} from "@/lib/workspace-session";

const HistoryPanel = dynamic(
  () => import("@/components/history-panel").then((mod) => mod.HistoryPanel),
);

export function Workspace() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [view, setView] = useState<"markdown" | "json">("markdown");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storageBackend, setStorageBackend] = useState<string | null>(null);
  const [extractOptions, setExtractOptions] = useState<ExtractOptions>(DEFAULT_EXTRACT_OPTIONS);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [markdownDraft, setMarkdownDraft] = useState("");
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>("preview");
  const [markdownToolbar, setMarkdownToolbar] = useState(true);
  const convertAbortRef = useRef<AbortController | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);

  const refreshHistory = useCallback(async () => {
    try {
      const data = await fetchHistory();
      setHistory(data.items);
      setStorageBackend(data.storage_backend);
    } catch {
      // Keep existing list if refresh fails
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const applyHistoryDetail = useCallback(
    async (
      id: string,
      options?: { draftOverride?: string; keepView?: boolean },
    ) => {
      const [detail, restored] = await Promise.all([
        fetchHistoryDetail(id),
        fetchHistoryFile(id, "document", null),
      ]);
      const fileFromHistory = new File([restored], detail.filename, {
        type: detail.content_type || restored.type,
        lastModified: Date.now(),
      });
      const nextResult: ExtractResponse = {
        id: detail.id,
        filename: detail.filename,
        content_type: detail.content_type,
        size_bytes: detail.size_bytes,
        engine: detail.engine || "FileWorks",
        page_count: detail.page_count,
        format: (detail.format as ExtractResponse["format"]) || "both",
        markdown: detail.markdown,
        json: detail.json,
        pages: detail.pages,
        created_at: detail.created_at,
        storage_backend: detail.storage_backend,
        regions: detail.regions || [],
        image_size: detail.image_size || null,
      };
      setFile(fileFromHistory);
      setResult(nextResult);
      setSelectedId(id);
      setMarkdownDraft(
        options?.draftOverride !== undefined ? options.draftOverride : detail.markdown || "",
      );
      if (!options?.keepView) {
        if (!detail.markdown && detail.json) setView("json");
        else setView("markdown");
      }
      return nextResult;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    fetchHealth()
      .then((data) => {
        if (active) {
          setHealth(data);
          if (data.storage_backend) setStorageBackend(data.storage_backend);
        }
      })
      .catch(() => {
        if (active) {
          setHealth({
            status: "offline",
            app: "FileWorks",
            ocr_ready: false,
            ocr_engine: null,
            ocr_error: "API unreachable",
            llm_ready: false,
            llm_provider: null,
            llm_error: "API unreachable",
            translate_ready: false,
            translate_provider: null,
            translate_error: "API unreachable",
            translate_languages: [],
          });
        }
      });
    refreshHistory();
    fetchMe()
      .then((data) => {
        if (active) setMe(data);
      })
      .catch(() => undefined);
    scheduleTokenRefresh(async () => {
      const ok = await refreshSession();
      if (ok) {
        const data = await fetchMe().catch(() => null);
        if (data) setMe(data);
      }
    });
    return () => {
      active = false;
    };
  }, [refreshHistory]);

  useEffect(() => {
    if (!me) return;
    void refreshHistory();
  }, [me?.user?.id, me?.plan, refreshHistory]);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      const prefs = loadWorkspacePrefs();
      setView(prefs.view);
      setHistoryOpen(prefs.historyOpen);
      setPreviewOpen(prefs.previewOpen);
      setExtractOptions(prefs.extractOptions);
      setMarkdownMode(prefs.markdownMode);
      setMarkdownToolbar(prefs.markdownToolbar !== false);
      setMarkdownDraft(prefs.markdownDraft);
      setSelectedId(prefs.selectedId);
      if (prefs.result && !prefs.selectedId) {
        setResult(prefs.result);
      }

      try {
        if (prefs.selectedId) {
          await applyHistoryDetail(prefs.selectedId, {
            draftOverride: prefs.markdownDraft || undefined,
            keepView: true,
          });
        } else {
          const cached = await loadSessionFile();
          if (cached && !cancelled) setFile(cached);
          if (prefs.result && !cancelled) setResult(prefs.result);
        }
      } catch {
        const cached = await loadSessionFile();
        if (!cancelled) {
          if (cached) setFile(cached);
          if (prefs.result) setResult(prefs.result);
        }
      } finally {
        if (!cancelled) setSessionReady(true);
      }
    }
    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [applyHistoryDetail]);

  useEffect(() => {
    if (!sessionReady) return;
    const bulky = markdownDraft.includes("data:image") || Boolean(result?.markdown?.includes("data:image"));
    saveWorkspacePrefs({
      selectedId,
      view,
      historyOpen,
      previewOpen,
      extractOptions,
      markdownMode,
      markdownToolbar,
      markdownDraft: bulky ? "" : markdownDraft,
      result: selectedId ? null : bulky && result ? { ...result, markdown: "" } : result,
    });
  }, [
    sessionReady,
    selectedId,
    view,
    historyOpen,
    previewOpen,
    extractOptions,
    markdownMode,
    markdownToolbar,
    markdownDraft,
    result,
  ]);

  useEffect(() => {
    if (!sessionReady) return;
    void saveSessionFile(file).catch(() => undefined);
  }, [sessionReady, file]);

  useEffect(() => {
    if (!sessionReady) return;
    const warm = () => {
      void prefetchHeavyUi();
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(warm, 1200);
    return () => window.clearTimeout(timer);
  }, [sessionReady]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    return () => {
      convertAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!me) return;
    setExtractOptions((current) => {
      const next = { ...current };
      let changed = false;
      if ((!me.permissions["extract.ai"] || !aiQuotaLeft(me.quota)) && next.use_ai) {
        next.use_ai = false;
        changed = true;
      }
      if ((!me.permissions["extract.translate"] || !aiQuotaLeft(me.quota)) && next.target_lang) {
        next.target_lang = "";
        changed = true;
      }
      return changed ? next : current;
    });
  }, [me]);

  const signedIn = Boolean(me?.user);
  const quotaBlocked =
    signedIn && (me?.quota.remaining_day === 0 || me?.quota.remaining_month === 0);
  const canExtract =
    Boolean(file) && !loading && signedIn && Boolean(me?.permissions["extract"]) && !quotaBlocked;

  function handleStopConvert() {
    convertAbortRef.current?.abort();
  }

  async function handleExtract() {
    if (!file || !me?.user || !me.permissions["extract"]) return;
    convertAbortRef.current?.abort();
    const controller = new AbortController();
    convertAbortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const data = await extractDocument(file, "both", extractOptions, controller.signal, {
        directUpload: health?.direct_upload === true || health?.storage_backend === "s3",
      });
      if (controller.signal.aborted) return;
      setResult(data);
      setMarkdownDraft(data.markdown || "");
      setSelectedId(data.id ?? null);
      setActiveRegionId(null);
      if (!data.markdown && data.json) setView("json");
      else setView("markdown");
      await refreshHistory();
      const nextMe = await fetchMe().catch(() => null);
      if (nextMe) setMe(nextMe);
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        setError(null);
        return;
      }
      setResult(null);
      setMarkdownDraft("");
      setActiveRegionId(null);
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      if (convertAbortRef.current === controller) {
        convertAbortRef.current = null;
      }
      setLoading(false);
    }
  }

  function handleFileSelect(next: File | null) {
    setFile(next);
    setResult(null);
    setMarkdownDraft("");
    setMarkdownMode("preview");
    setError(null);
    setSelectedId(null);
    setActiveRegionId(null);
  }

  async function handleSelectHistory(id: string) {
    setLoading(true);
    setError(null);
    setActiveRegionId(null);
    try {
      await applyHistoryDetail(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restore document");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteHistory(id: string) {
    try {
      await deleteHistoryItem(id);
      if (selectedId === id) {
        setSelectedId(null);
        setFile(null);
        setResult(null);
        setMarkdownDraft("");
        setActiveRegionId(null);
      }
      await refreshHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete document");
    }
  }

  return (
    <div className="app-shell app-shell-fixed relative">
      <div className="atmosphere" aria-hidden />

      <header className="relative z-10 shrink-0 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <p className="font-[family-name:var(--font-display)] text-xl tracking-tight md:text-2xl">
            FileWorks
          </p>
          <button
            type="button"
            aria-expanded={historyOpen}
            aria-controls="history-panel"
            aria-label={historyOpen ? "Hide history" : "Show history"}
            onClick={() => setHistoryOpen((open) => !open)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs transition",
              historyOpen
                ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                : "text-[var(--ink-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]",
            )}
          >
            {historyOpen ? <PanelLeftClose size={15} /> : <Clock3 size={15} />}
            <span className="hidden sm:inline">History</span>
            {!historyOpen && history.length > 0 ? (
              <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] leading-4 text-white dark:text-[#06281d]">
                {history.length}
              </span>
            ) : null}
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <a
              href="/pricing"
              className="rounded-full px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
            >
              Pricing
            </a>
            {health?.status === "offline" ? (
              <span title="API offline" className="inline-flex p-1.5 text-[var(--danger)]">
                <WifiOff size={14} />
              </span>
            ) : null}
            <AuthBar me={me} />
            <ThemeToggle className="h-8 w-8" />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col gap-3 overflow-hidden px-4 py-3 md:px-6 md:py-4">
        {!previewOpen ? (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2">
            <button
              type="button"
              aria-controls="source-preview-panel"
              onClick={() => setPreviewOpen(true)}
              className="inline-flex items-center gap-2 rounded-full px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
            >
              <FileImage size={14} />
              Show preview
            </button>
            <ConvertControls
              compact
              fileName={file?.name}
              options={extractOptions}
              onChange={setExtractOptions}
              me={me}
              health={health}
              loading={loading}
              canExtract={canExtract}
              fileReady={Boolean(file)}
              quotaBlocked={Boolean(quotaBlocked)}
              onConvert={handleExtract}
              onStop={handleStopConvert}
            />
          </div>
        ) : null}

        <div
          className={cn(
            "grid min-h-0 flex-1 gap-3 overflow-hidden lg:gap-4",
            historyOpen && previewOpen && "grid-rows-3 lg:grid-rows-1 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]",
            historyOpen && !previewOpen && "grid-rows-2 lg:grid-rows-1 lg:grid-cols-[220px_minmax(0,1fr)]",
            !historyOpen && previewOpen && "grid-rows-2 lg:grid-rows-1 lg:grid-cols-2",
            !historyOpen && !previewOpen && "grid-rows-1",
          )}
        >
          {historyOpen ? (
            <div id="history-panel" className="min-h-0 overflow-hidden">
              <HistoryPanel
                items={history}
                selectedId={selectedId}
                loading={historyLoading}
                storageBackend={storageBackend}
                requiresLogin={!me?.permissions?.["history.read"]}
                onSelect={handleSelectHistory}
                onDelete={handleDeleteHistory}
                onCollapse={() => setHistoryOpen(false)}
              />
            </div>
          ) : null}
          {previewOpen ? (
            <div id="source-preview-panel" className="min-h-0 overflow-hidden">
              <UploadPanel
                file={file}
                previewUrl={previewUrl}
                disabled={loading}
                regions={result?.regions || []}
                imageSize={result?.image_size || null}
                activeRegionId={activeRegionId}
                onActiveRegionChange={setActiveRegionId}
                onFileSelect={handleFileSelect}
                onCollapse={() => setPreviewOpen(false)}
                actions={
                  <ConvertControls
                    compact
                    options={extractOptions}
                    onChange={setExtractOptions}
                    me={me}
                    health={health}
                    loading={loading}
                    canExtract={canExtract}
                    fileReady={Boolean(file)}
                    quotaBlocked={Boolean(quotaBlocked)}
                    onConvert={handleExtract}
                    onStop={handleStopConvert}
                  />
                }
              />
            </div>
          ) : null}
          <div className="min-h-0 overflow-hidden">
            <ResultPanel
              result={result}
              loading={loading}
              error={error}
              view={view}
              onViewChange={setView}
              activeRegionId={activeRegionId}
              onActiveRegionChange={setActiveRegionId}
              markdownDraft={markdownDraft}
              onMarkdownChange={setMarkdownDraft}
              markdownMode={markdownMode}
              onMarkdownModeChange={setMarkdownMode}
              toolbarVisible={markdownToolbar}
              onToolbarVisibleChange={setMarkdownToolbar}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
