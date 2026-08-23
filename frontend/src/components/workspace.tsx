"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Clock3, FileImage, WifiOff } from "lucide-react";
import {
  cancelExtract,
  deleteHistoryItem,
  extractDocument,
  fetchHealth,
  newRunId,
  fetchHistory,
  fetchHistoryDetail,
  fetchHistoryFile,
  fetchTemplates,
  isAbortError,
  renderStarter,
  renderTemplate,
  DEFAULT_EXTRACT_OPTIONS,
  type ExtractOptions,
  type ExtractResponse,
  type HealthResponse,
  type HistoryItem,
  type TemplateRecord,
} from "@/lib/api";
import { AuthBar } from "@/components/auth-bar";
import { BrandLockup } from "@/components/brand-lockup";
import { ConvertControls } from "@/components/convert-controls";
import { ResultPanel } from "@/components/result-panel";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import { UploadPanel } from "@/components/upload-panel";
import { historyCache } from "@/lib/history-cache";
import { prefetchHeavyUi } from "@/lib/prefetch";
import { reloadSession, useSession } from "@/lib/session";
import { aiQuotaLeft } from "@/lib/plans";
import { cn } from "@/lib/utils";
import {
  loadWorkspacePrefs,
  saveSessionFile,
  saveWorkspacePrefs,
  type MarkdownMode,
} from "@/lib/workspace-session";
import { BUILT_IN_TEMPLATES, builtInTemplate } from "@/design-pad/templates";
import { isStaticTemplate } from "@/design-pad/templating";
import { PRODUCT } from "@/lib/product-copy";

const HistoryPanel = dynamic(
  () => import("@/components/history-panel").then((mod) => mod.HistoryPanel),
);

const BUILTIN_PREFIX = "builtin:";

function parseBuiltinLayout(layout: string): string | null {
  if (!layout.startsWith(BUILTIN_PREFIX)) return null;
  return layout.slice(BUILTIN_PREFIX.length) || null;
}

/** Resolve ?produce= / ?design= into an outputLayout id. */
function layoutFromProduceParam(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value || value === "standard" || value === "markdown") return "standard";
  if (value.startsWith(BUILTIN_PREFIX)) {
    const id = value.slice(BUILTIN_PREFIX.length);
    return builtInTemplate(id) ? value : null;
  }
  if (builtInTemplate(value)) return `${BUILTIN_PREFIX}${value}`;
  // Saved design ids are UUIDs / opaque strings — accept as-is for deep links.
  if (/^[a-zA-Z0-9_-]{8,}$/.test(value)) return value;
  return null;
}

export function Workspace() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResponse | null>(null);
  const [view, setView] = useState<"markdown" | "json">("markdown");
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [busyKind, setBusyKind] = useState<"convert" | "restore">("convert");
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storageBackend, setStorageBackend] = useState<string | null>(null);
  const [extractOptions, setExtractOptions] = useState<ExtractOptions>(DEFAULT_EXTRACT_OPTIONS);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [markdownDraft, setMarkdownDraft] = useState("");
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>("preview");
  const [markdownToolbar, setMarkdownToolbar] = useState(true);
  const [templates, setTemplates] = useState<TemplateRecord[]>([]);
  const [outputLayout, setOutputLayout] = useState("standard");
  const [returnFileType, setReturnFileType] = useState<"markdown" | "docx" | "pdf">("markdown");
  const [produceAsOpen, setProduceAsOpen] = useState(false);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [templateWarning, setTemplateWarning] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [activeTemplateName, setActiveTemplateName] = useState<string | null>(null);
  const convertAbortRef = useRef<AbortController | null>(null);
  const convertRunIdRef = useRef<string | null>(null);
  const historySelectGenRef = useRef(0);
  const [sessionReady, setSessionReady] = useState(false);
  const { status: authStatus, me, displayUser } = useSession();
  const historyUserRef = useRef<string | null>(null);

  const refreshHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const data = await fetchHistory();
      historyCache.syncWithList(data.items);
      setHistory(data.items);
      setStorageBackend(data.storage_backend);
      return data.items;
    } catch {
      // Keep existing list if refresh fails
      return null;
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const paintHistoryDetail = useCallback(
    (id: string, detail: ExtractResponse, nextFile: File | null) => {
      if (nextFile) setFile(nextFile);
      setResult({
        id: detail.id ?? id,
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
        structure: detail.structure ?? null,
        options: detail.options ?? null,
      });
      setSelectedId(id);
      setMarkdownDraft(detail.markdown || "");
      if (!detail.markdown && detail.json) setView("json");
      else setView("markdown");
    },
    [],
  );

  const loadHistoryFile = useCallback(
    async (id: string, detail: ExtractResponse, selectGen: number) => {
      const restored = await fetchHistoryFile(id, detail.filename, detail.content_type);
      const fileFromHistory = new File([restored], detail.filename, {
        type: detail.content_type || restored.type,
        lastModified: Date.now(),
      });
      historyCache.putFile(id, fileFromHistory);
      if (selectGen !== historySelectGenRef.current) return;
      setFile(fileFromHistory);
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
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Guests skip the history request so first paint is the product, not a spinner.
    if (authStatus === "unknown") return;
    if (authStatus !== "signed-in") {
      if (historyUserRef.current) historyCache.clear();
      historyUserRef.current = null;
      setHistory([]);
      setHistoryLoading(false);
      return;
    }
    const key = me?.user?.id ?? "session";
    if (historyUserRef.current == null) {
      historyUserRef.current = key;
      void refreshHistory();
      return;
    }
    if (me?.user?.id && historyUserRef.current !== me.user.id) {
      if (historyUserRef.current !== "session") {
        historyCache.clear();
        void refreshHistory();
      }
      historyUserRef.current = me.user.id;
    }
  }, [authStatus, me?.user?.id, refreshHistory]);

  useEffect(() => {
    if (!me?.user) return;
    void fetchTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [me?.user]);

  useEffect(() => {
    const prefs = loadWorkspacePrefs();
    setView(prefs.view);
    setHistoryOpen(prefs.historyOpen);
    setPreviewOpen(prefs.previewOpen);
    setExtractOptions(prefs.extractOptions);
    setMarkdownMode(prefs.markdownMode);
    setMarkdownToolbar(prefs.markdownToolbar !== false);
    void saveSessionFile(null).catch(() => undefined);

    // Design → workspace bridge: /?produce=invoice or /?design=builtin:invoice
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const fromQuery = layoutFromProduceParam(params.get("produce") || params.get("design"));
      if (fromQuery) {
        setOutputLayout(fromQuery);
        params.delete("produce");
        params.delete("design");
        const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
        window.history.replaceState({}, "", next);
      }
    }

    setSessionReady(true);
  }, []);

  useEffect(() => {
    if (!sessionReady) return;
    saveWorkspacePrefs({
      selectedId: null,
      view,
      historyOpen,
      previewOpen,
      extractOptions,
      markdownMode,
      markdownToolbar,
      markdownDraft: "",
      result: null,
    });
  }, [sessionReady, view, historyOpen, previewOpen, extractOptions, markdownMode, markdownToolbar]);

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
  const designTargets = BUILT_IN_TEMPLATES.map((item) => ({
    id: `${BUILTIN_PREFIX}${item.id}`,
    name: item.name,
    description: item.description,
    category: item.category,
  }));
  const fillableTemplates = signedIn
    ? templates.filter((template) => {
        const declared = template.variable_count ?? template.document?.variables?.length ?? 0;
        if (declared <= 0) return false;
        // Starter copies used for Home fill stay under starter designs, not My designs.
        if (template.page_label?.startsWith("starter:")) return false;
        return true;
      })
    : [];
  const builtinStarterId = parseBuiltinLayout(outputLayout);
  const selectedBuiltIn = builtinStarterId ? builtInTemplate(builtinStarterId) : null;
  const selectedSaved =
    signedIn && outputLayout !== "standard" && !builtinStarterId
      ? fillableTemplates.find((template) => template.id === outputLayout) || null
      : null;
  const hasTargetTemplate = Boolean(selectedBuiltIn || selectedSaved);
  const selectedTemplateStatic = selectedSaved
    ? isStaticTemplate(selectedSaved.document)
    : selectedBuiltIn
      ? false
      : false;

  useEffect(() => {
    if (outputLayout === "standard") return;
    if (builtinStarterId) {
      if (!builtInTemplate(builtinStarterId)) setOutputLayout("standard");
      return;
    }
    if (!fillableTemplates.some((template) => template.id === outputLayout)) {
      setOutputLayout("standard");
    }
  }, [builtinStarterId, fillableTemplates, outputLayout]);

  async function resolveTargetTemplate(): Promise<{
    id: string;
    name: string;
    isStatic: boolean;
    kind: "starter" | "saved";
  } | null> {
    if (outputLayout === "standard") return null;
    if (builtinStarterId) {
      const builtIn = builtInTemplate(builtinStarterId);
      if (!builtIn) return null;
      const document = builtIn.build();
      return {
        id: builtinStarterId,
        name: builtIn.name,
        isStatic: isStaticTemplate(document),
        kind: "starter",
      };
    }
    if (!selectedSaved) return null;
    return {
      id: selectedSaved.id,
      name: selectedSaved.name,
      isStatic: isStaticTemplate(selectedSaved.document),
      kind: "saved",
    };
  }

  async function renderTarget(
    target: { id: string; kind: "starter" | "saved" },
    input: {
      markdown: string;
      format?: "html" | "docx" | "pdf" | "markdown";
      fill?: "auto" | "defaults" | "none";
      variables?: Record<string, unknown>;
    },
  ) {
    if (target.kind === "starter") {
      return renderStarter(target.id, input);
    }
    return renderTemplate(target.id, input);
  }
  const quotaBlocked =
    signedIn && (me?.quota.remaining_day === 0 || me?.quota.remaining_month === 0);
  // Never cover the workspace with a boot gate. New visitors should see the
  // dropzone and a sign-in prompt immediately; history loads inside its panel.
  const uiLocked = loading || restoring;
  const canExtract =
    (Boolean(file) || selectedTemplateStatic) &&
    !loading &&
    !restoring &&
    signedIn &&
    Boolean(me?.permissions["extract"]) &&
    !quotaBlocked;

  function stopActiveRun() {
    convertAbortRef.current?.abort();
    // Tell the server too — a dropped disconnect would leave the run holding the slot.
    const runId = convertRunIdRef.current;
    if (runId) void cancelExtract(runId);
    convertRunIdRef.current = null;
  }

  function handleStopConvert() {
    stopActiveRun();
  }

  async function handleExtract(opts?: { fill?: "auto" | "defaults" }) {
    if (uiLocked || (!file && !selectedTemplateStatic) || !me?.user || !me.permissions["extract"]) return;
    stopActiveRun();
    const controller = new AbortController();
    convertAbortRef.current = controller;
    const runId = newRunId();
    convertRunIdRef.current = runId;
    setBusyKind("convert");
    setLoading(true);
    setError(null);
    setRenderedHtml(null);
    setTemplateWarning(null);
    setActiveTemplateId(null);
    setActiveTemplateName(null);
    try {
      const target = hasTargetTemplate ? await resolveTargetTemplate() : null;
      const data = file
        ? await extractDocument(file, "both", extractOptions, controller.signal, {
            directUpload: health?.direct_upload === true || health?.storage_backend === "s3",
            runId,
          })
        : {
            filename: target?.name || "Design output",
            content_type: "text/html",
            size_bytes: 0,
            engine: "FileWorks",
            page_count: 1,
            format: "both" as const,
            markdown: "",
            json: null,
            pages: [],
          };
      if (controller.signal.aborted) return;
      setResult(data);
      setMarkdownDraft(data.markdown || "");
      setSelectedId(data.id ?? null);
      setActiveRegionId(null);
      if (!data.markdown && data.json) setView("json");
      else setView("markdown");
      if (target) {
        setActiveTemplateId(target.id);
        setActiveTemplateName(target.name);
        const fill =
          opts?.fill ?? (target.isStatic || !(data.markdown || "").trim() ? "defaults" : "auto");
        try {
          const rendered = await renderTarget(target, {
            markdown: data.markdown || "",
            format: "html",
            fill,
          });
          setRenderedHtml(rendered.html);
          setMarkdownMode("preview");
          if (target.isStatic) {
            setTemplateWarning("This design is static; its output ignores the uploaded document.");
          } else if (fill === "defaults") {
            setTemplateWarning("Showing sample defaults (AI fill skipped).");
          } else {
            setTemplateWarning(null);
          }
        } catch (renderErr) {
          setRenderedHtml(null);
          setMarkdownMode("edit");
          setTemplateWarning(
            renderErr instanceof Error ? renderErr.message : "Design fill failed",
          );
        }
      }
      if (file) {
        if (data.id) {
          historyCache.putDetail(data.id, data, null, file);
        }
        const items = await refreshHistory();
        if (data.id && items) {
          const summary = items.find((item) => item.id === data.id) ?? null;
          historyCache.putDetail(data.id, data, summary, file);
        }
      }
      await reloadSession().catch(() => undefined);
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) {
        setError(null);
        return;
      }
      setResult(null);
      setMarkdownDraft("");
      setActiveRegionId(null);
      setRenderedHtml(null);
      setActiveTemplateId(null);
      setActiveTemplateName(null);
      setError(err instanceof Error ? err.message : "Conversion failed");
    } finally {
      if (convertAbortRef.current === controller) {
        convertAbortRef.current = null;
      }
      if (convertRunIdRef.current === runId) {
        convertRunIdRef.current = null;
      }
      setLoading(false);
    }
  }

  async function handleUpdateFilledFromSource() {
    if (!hasTargetTemplate) return;
    const markdown = markdownDraft || result?.markdown || "";
    if (!markdown.trim()) {
      setTemplateWarning("Add source markdown before updating the filled document.");
      return;
    }
    setBusyKind("convert");
    setLoading(true);
    try {
      const target = await resolveTargetTemplate();
      if (!target || target.isStatic) return;
      setActiveTemplateId(target.id);
      setActiveTemplateName(target.name);
      const rendered = await renderTarget(target, {
        markdown,
        format: "html",
        fill: "auto",
      });
      setRenderedHtml(rendered.html);
      setMarkdownMode("preview");
      setView("markdown");
      setTemplateWarning(null);
      await reloadSession().catch(() => undefined);
    } catch (err) {
      setTemplateWarning(err instanceof Error ? err.message : "Design fill failed");
    } finally {
      setLoading(false);
    }
  }

  function handleFileSelect(next: File | null) {
    if (uiLocked) return;
    setFile(next);
    setResult(null);
    setMarkdownDraft("");
    setMarkdownMode("preview");
    setError(null);
    setRenderedHtml(null);
    setTemplateWarning(null);
    setActiveTemplateId(null);
    setActiveTemplateName(null);
    setSelectedId(null);
    setActiveRegionId(null);
  }

  async function handleSelectHistory(id: string) {
    if (uiLocked) return;
    const selectGen = ++historySelectGenRef.current;
    setError(null);
    setActiveRegionId(null);
    setRestoring(true);

    const summary = history.find((item) => item.id === id) ?? null;
    const cached = historyCache.getIfFresh(id, summary);
    try {
      if (cached) {
        paintHistoryDetail(id, cached.detail, cached.file);
        if (!cached.file) {
          await loadHistoryFile(id, cached.detail, selectGen);
        }
        return;
      }

      setBusyKind("restore");
      setLoading(true);
      try {
        const detail = await fetchHistoryDetail(id);
        if (selectGen !== historySelectGenRef.current) return;
        historyCache.putDetail(id, detail, summary, null);
        paintHistoryDetail(id, detail, null);
        setLoading(false);
        await loadHistoryFile(id, detail, selectGen);
      } catch (err) {
        if (selectGen !== historySelectGenRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to restore document");
        await refreshHistory();
      } finally {
        if (selectGen === historySelectGenRef.current) {
          setLoading(false);
        }
      }
    } catch (err) {
      if (selectGen !== historySelectGenRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to restore document");
    } finally {
      if (selectGen === historySelectGenRef.current) {
        setRestoring(false);
      }
    }
  }

  async function handleDeleteHistory(id: string) {
    if (uiLocked) return;
    try {
      await deleteHistoryItem(id);
      historyCache.delete(id);
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

  const intentDisplayName = hasTargetTemplate
    ? selectedBuiltIn?.name || selectedSaved?.name || PRODUCT.design
    : null;

  const convertControls = (
    <ConvertControls
      compact
      fileName={previewOpen ? undefined : file?.name}
      options={extractOptions}
      onChange={setExtractOptions}
      me={me}
      health={health}
      loading={loading}
      canExtract={canExtract}
      fileReady={Boolean(file) || selectedTemplateStatic}
      quotaBlocked={Boolean(quotaBlocked)}
      onConvert={handleExtract}
      onConvertWithDefaults={() => handleExtract({ fill: "defaults" })}
      onStop={handleStopConvert}
      outputLayout={outputLayout}
      designTargets={designTargets}
      templates={fillableTemplates.map((template) => ({ id: template.id, name: template.name }))}
      templateNeedsAi={hasTargetTemplate && !selectedTemplateStatic}
      returnFileType={returnFileType}
      onOutputLayoutChange={(value) => {
        setOutputLayout(value);
        setRenderedHtml(null);
        setTemplateWarning(null);
        setActiveTemplateId(null);
        setActiveTemplateName(null);
      }}
      onReturnFileTypeChange={setReturnFileType}
      produceAsOpen={produceAsOpen}
      onProduceAsOpenChange={setProduceAsOpen}
    />
  );

  return (
    <div className="app-shell app-shell-fixed relative">
      <div className="atmosphere" aria-hidden />

      <header className="relative z-10 shrink-0 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <BrandLockup asHeading />
          <p className="hidden min-w-0 truncate text-xs text-[var(--ink-muted)] sm:block lg:max-w-[28rem]">
            {PRODUCT.homeLine}
          </p>
          <div className="ml-auto flex items-center gap-1.5">
            <a
              href="/templates"
              className="rounded-full px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
            >
              Designs
            </a>
            <a
              href="/pricing"
              className="rounded-full px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
            >
              Pricing
            </a>
            <a
              href="/docs"
              className="rounded-full px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
            >
              API
            </a>
            <a
              href="/legal"
              className="rounded-full px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
            >
              Legal
            </a>
            {health?.status === "offline" ? (
              <span title="API offline" className="inline-flex p-1.5 text-[var(--danger)]">
                <WifiOff size={14} />
              </span>
            ) : null}
            <AuthBar me={me} status={authStatus} user={displayUser} />
            <ThemeToggle className="h-8 w-8" />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col overflow-hidden px-4 py-3 md:px-6 md:py-4">
        <div
          className={cn(
            "grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden lg:gap-4",
            previewOpen &&
              historyOpen &&
              "grid-rows-[minmax(140px,0.8fr)_minmax(140px,0.9fr)_minmax(0,1.2fr)] [grid-template-areas:'history'_'source'_'result'] lg:grid-rows-1 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)] lg:[grid-template-areas:'history_source_result']",
            previewOpen &&
              !historyOpen &&
              "grid-rows-[minmax(140px,1fr)_minmax(0,1.2fr)] [grid-template-areas:'source'_'result'] lg:grid-rows-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:[grid-template-areas:'source_result']",
            !previewOpen &&
              historyOpen &&
              "grid-rows-[minmax(140px,0.8fr)_minmax(0,1.2fr)] [grid-template-areas:'history'_'result'] lg:grid-rows-1 lg:grid-cols-[220px_minmax(0,1fr)] lg:[grid-template-areas:'history_result']",
            !previewOpen && !historyOpen && "grid-rows-1 [grid-template-areas:'result'] lg:grid-cols-1",
          )}
        >
          {previewOpen ? (
            <div id="source-preview-panel" className="min-h-0 overflow-hidden [grid-area:source]">
              <UploadPanel
                file={file}
                previewUrl={previewUrl}
                disabled={uiLocked}
                regions={result?.regions || []}
                imageSize={result?.image_size || null}
                activeRegionId={activeRegionId}
                onActiveRegionChange={setActiveRegionId}
                onFileSelect={handleFileSelect}
                onCollapse={() => setPreviewOpen(false)}
                actions={convertControls}
                intentName={intentDisplayName}
                onChooseIntent={() => setProduceAsOpen(true)}
                leadingToggle={
                  historyOpen ? undefined : (
                    <PaneIcon
                      label="Show history"
                      controls="history-panel"
                      badge={history.length}
                      onClick={() => setHistoryOpen(true)}
                    >
                      <Clock3 size={15} />
                    </PaneIcon>
                  )
                }
              />
            </div>
          ) : null}
          <div className="min-h-0 overflow-hidden [grid-area:result]">
            <ResultPanel
              result={result}
              loading={loading}
              busyLabel={
                busyKind === "restore" ? "Opening your document…" : "Converting your file…"
              }
              busyHint={busyKind === "restore" ? null : "Use Stop to cancel"}
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
              actions={previewOpen ? undefined : convertControls}
              leadingToggle={
                previewOpen ? undefined : (
                  <>
                    {historyOpen ? null : (
                      <PaneIcon
                        label="Show history"
                        controls="history-panel"
                        badge={history.length}
                        onClick={() => setHistoryOpen(true)}
                      >
                        <Clock3 size={15} />
                      </PaneIcon>
                    )}
                    <PaneIcon
                      label="Show source"
                      controls="source-preview-panel"
                      onClick={() => setPreviewOpen(true)}
                    >
                      <FileImage size={15} />
                    </PaneIcon>
                  </>
                )
              }
              renderedHtml={renderedHtml}
              templateId={activeTemplateId}
              templateName={activeTemplateName}
              templateWarning={templateWarning}
              templateReturnFileType={returnFileType}
              intentName={intentDisplayName}
              onChooseIntent={() => setProduceAsOpen(true)}
              onUpdateFilledFromSource={
                hasTargetTemplate && !selectedTemplateStatic ? handleUpdateFilledFromSource : undefined
              }
            />
          </div>
          {historyOpen ? (
            <div id="history-panel" className="min-h-0 overflow-hidden [grid-area:history]">
              <HistoryPanel
                items={history}
                selectedId={selectedId}
                loading={historyLoading}
                disabled={uiLocked}
                storageBackend={storageBackend}
                requiresLogin={authStatus !== "signed-in" || (me != null && !me.permissions?.["history.read"])}
                onSelect={handleSelectHistory}
                onDelete={handleDeleteHistory}
                onCollapse={() => setHistoryOpen(false)}
              />
            </div>
          ) : null}
        </div>
      </main>
      <SiteFooter compact />
    </div>
  );
}

function PaneIcon({
  label,
  controls,
  badge,
  onClick,
  children,
}: {
  label: string;
  controls: string;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={false}
      aria-controls={controls}
      aria-label={label}
      title={label}
      onClick={onClick}
      className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
    >
      {children}
      {badge ? (
        <span className="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-[var(--accent)] px-1 text-[9px] leading-[14px] text-white dark:text-[#06281d]">
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
    </button>
  );
}
