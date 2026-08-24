"use client";

import { useCallback, useEffect, useRef, useState, forwardRef, type ReactNode, type Ref } from "react";
import dynamic from "next/dynamic";
import { Clock3, FileImage, WifiOff } from "lucide-react";
import {
  cancelExtract,
  deleteHistoryItem,
  downloadBlob,
  downloadTextFile,
  extractDocument,
  fetchHealth,
  newRunId,
  fetchHistory,
  fetchHistoryDetail,
  fetchHistoryFile,
  fetchTemplates,
  isAbortError,
  patchHistoryDesign,
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
import { ConvertControls, TargetFormatDialog } from "@/components/convert-controls";
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
  const [templatesReady, setTemplatesReady] = useState(false);
  const [outputLayout, setOutputLayout] = useState("standard");
  const [returnFileType, setReturnFileType] = useState<"markdown" | "docx" | "pdf">("markdown");
  const [produceAsOpen, setProduceAsOpen] = useState(false);
  const [renderedHtml, setRenderedHtml] = useState<string | null>(null);
  const [designMarkdown, setDesignMarkdown] = useState<string | null>(null);
  const [designContext, setDesignContext] = useState<Record<string, unknown> | null>(null);
  const [templateWarning, setTemplateWarning] = useState<string | null>(null);
  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [activeTemplateName, setActiveTemplateName] = useState<string | null>(null);
  const [activeTemplateKind, setActiveTemplateKind] = useState<"starter" | "saved" | null>(null);
  const convertAbortRef = useRef<AbortController | null>(null);
  const convertRunIdRef = useRef<string | null>(null);
  const historySelectGenRef = useRef(0);
  const showSourceRef = useRef<HTMLButtonElement>(null);
  const restoreShowSourceFocusRef = useRef(false);
  const focusSourcePaneRef = useRef(false);
  /** Keeps filled design across history re-select races (cache before design patch). */
  const designSessionRef = useRef<{
    documentId: string | null;
    templateId: string | null;
    templateName: string | null;
    templateKind: "starter" | "saved" | null;
    html: string | null;
    markdown: string | null;
    context: Record<string, unknown> | null;
  }>({
    documentId: null,
    templateId: null,
    templateName: null,
    templateKind: null,
    html: null,
    markdown: null,
    context: null,
  });
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

  const clearDesignState = useCallback(() => {
    designSessionRef.current = {
      documentId: null,
      templateId: null,
      templateName: null,
      templateKind: null,
      html: null,
      markdown: null,
      context: null,
    };
    setRenderedHtml(null);
    setDesignMarkdown(null);
    setDesignContext(null);
    setTemplateWarning(null);
    setActiveTemplateId(null);
    setActiveTemplateName(null);
    setActiveTemplateKind(null);
  }, []);

  const rememberDesignSession = useCallback(
    (payload: {
      documentId: string | null;
      templateId: string;
      templateName: string | null;
      templateKind: "starter" | "saved";
      html: string;
      markdown?: string | null;
      context?: Record<string, unknown> | null;
    }) => {
      designSessionRef.current = {
        documentId: payload.documentId,
        templateId: payload.templateId,
        templateName: payload.templateName,
        templateKind: payload.templateKind,
        html: payload.html,
        markdown: payload.markdown ?? null,
        context: payload.context ?? null,
      };
    },
    [],
  );

  const inferTemplateKind = useCallback((templateId: string): "starter" | "saved" => {
    return builtInTemplate(templateId) ? "starter" : "saved";
  }, []);

  const persistDesignOutput = useCallback(
    async (
      documentId: string | null | undefined,
      payload: {
        templateId: string;
        templateName: string | null;
        html: string;
        markdown?: string | null;
        context?: Record<string, unknown> | null;
        returnFormat?: "docx" | "pdf";
      },
    ) => {
      if (!documentId) return;
      try {
        const detail = await patchHistoryDesign(documentId, {
          design_template_id: payload.templateId,
          design_template_name: payload.templateName,
          design_html: payload.html,
          design_markdown: payload.markdown ?? null,
          design_context: payload.context ?? null,
          design_return_format: payload.returnFormat ?? (returnFileType === "markdown" ? "pdf" : returnFileType),
        });
        historyCache.putDetail(documentId, detail, null, file);
        await refreshHistory();
      } catch {
        // History persist is best-effort; session preview still works.
      }
    },
    [file, refreshHistory, returnFileType],
  );

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
        design_template_id: detail.design_template_id ?? null,
        design_template_name: detail.design_template_name ?? null,
        design_html: detail.design_html ?? null,
        design_markdown: detail.design_markdown ?? null,
        design_context: detail.design_context ?? null,
        design_return_format: detail.design_return_format ?? null,
      });
      setSelectedId(id);
      setMarkdownDraft(detail.markdown || "");
      if (detail.design_html && detail.design_template_id) {
        const kind = builtInTemplate(detail.design_template_id) ? "starter" : "saved";
        setRenderedHtml(detail.design_html);
        setDesignMarkdown(detail.design_markdown ?? null);
        setDesignContext(detail.design_context ?? null);
        setActiveTemplateId(detail.design_template_id);
        setActiveTemplateName(detail.design_template_name ?? null);
        setActiveTemplateKind(kind);
        rememberDesignSession({
          documentId: id,
          templateId: detail.design_template_id,
          templateName: detail.design_template_name ?? null,
          templateKind: kind,
          html: detail.design_html,
          markdown: detail.design_markdown,
          context: detail.design_context,
        });
        // Keep Produce-as in sync so re-fill / download resolve the same template.
        setOutputLayout(kind === "starter" ? `${BUILTIN_PREFIX}${detail.design_template_id}` : detail.design_template_id);
        const fmt = detail.design_return_format;
        setReturnFileType(fmt === "docx" || fmt === "pdf" ? fmt : "pdf");
        setMarkdownMode("preview");
        setView("markdown");
        setTemplateWarning(null);
      } else {
        const cachedDesign = designSessionRef.current;
        // Avoid wiping a just-filled design when history cache lags behind the design patch.
        if (cachedDesign.documentId === id && cachedDesign.html && cachedDesign.templateId) {
          setRenderedHtml(cachedDesign.html);
          setDesignMarkdown(cachedDesign.markdown);
          setDesignContext(cachedDesign.context);
          setActiveTemplateId(cachedDesign.templateId);
          setActiveTemplateName(cachedDesign.templateName);
          setActiveTemplateKind(cachedDesign.templateKind);
          setMarkdownMode("preview");
          setView("markdown");
        } else {
          setRenderedHtml(null);
          setDesignMarkdown(null);
          setDesignContext(null);
          setActiveTemplateId(null);
          setActiveTemplateName(null);
          setActiveTemplateKind(null);
          designSessionRef.current = {
            documentId: null,
            templateId: null,
            templateName: null,
            templateKind: null,
            html: null,
            markdown: null,
            context: null,
          };
          if (!detail.markdown && detail.json) setView("json");
          else setView("markdown");
        }
      }
    },
    [rememberDesignSession],
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
    if (!me?.user) {
      setTemplates([]);
      setTemplatesReady(false);
      return;
    }
    let active = true;
    setTemplatesReady(false);
    void fetchTemplates()
      .then((items) => {
        if (active) setTemplates(items);
      })
      .catch(() => {
        if (active) setTemplates([]);
      })
      .finally(() => {
        if (active) setTemplatesReady(true);
      });
    return () => {
      active = false;
    };
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
    if (previewOpen) {
      if (!focusSourcePaneRef.current) return;
      focusSourcePaneRef.current = false;
      const hideBtn = document.querySelector<HTMLButtonElement>('[aria-label="Hide source"]');
      hideBtn?.focus();
      return;
    }
    if (restoreShowSourceFocusRef.current) {
      restoreShowSourceFocusRef.current = false;
      showSourceRef.current?.focus();
    }
  }, [previewOpen]);

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
    // Wait until saved templates load — otherwise a history-restored design id
    // is wiped to Markdown while the catalog is still empty.
    if (!templatesReady) return;
    if (!fillableTemplates.some((template) => template.id === outputLayout)) {
      setOutputLayout("standard");
    }
  }, [builtinStarterId, fillableTemplates, outputLayout, templatesReady]);

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
      envelope?: boolean;
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
    clearDesignState();
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
      let designPatch: Partial<ExtractResponse> = {};
      if (target) {
        setActiveTemplateId(target.id);
        setActiveTemplateName(target.name);
        setActiveTemplateKind(target.kind);
        const fill =
          opts?.fill ?? (target.isStatic || !(data.markdown || "").trim() ? "defaults" : "auto");
        const designFormat = returnFileType === "docx" ? "docx" : "pdf";
        try {
          const rendered = await renderTarget(target, {
            markdown: data.markdown || "",
            format: "html",
            fill,
            envelope: true,
          });
          setRenderedHtml(rendered.html);
          setDesignMarkdown(rendered.markdown ?? null);
          setDesignContext(rendered.context ?? null);
          setMarkdownMode("preview");
          rememberDesignSession({
            documentId: data.id ?? null,
            templateId: target.id,
            templateName: target.name,
            templateKind: target.kind,
            html: rendered.html,
            markdown: rendered.markdown,
            context: rendered.context,
          });
          designPatch = {
            design_template_id: target.id,
            design_template_name: target.name,
            design_html: rendered.html,
            design_markdown: rendered.markdown ?? null,
            design_context: rendered.context ?? null,
            design_return_format: designFormat,
          };
          setResult({ ...data, ...designPatch });
          if (target.isStatic) {
            setTemplateWarning("This design is static; its output ignores the uploaded document.");
          } else if (fill === "defaults") {
            setTemplateWarning("Showing sample defaults (AI fill skipped).");
          } else {
            setTemplateWarning(null);
          }
          await persistDesignOutput(data.id, {
            templateId: target.id,
            templateName: target.name,
            html: rendered.html,
            markdown: rendered.markdown,
            context: rendered.context,
            returnFormat: designFormat,
          });
        } catch (renderErr) {
          setRenderedHtml(null);
          setDesignMarkdown(null);
          setDesignContext(null);
          setActiveTemplateKind(null);
          designSessionRef.current = {
            documentId: null,
            templateId: null,
            templateName: null,
            templateKind: null,
            html: null,
            markdown: null,
            context: null,
          };
          setMarkdownMode("edit");
          setTemplateWarning(
            renderErr instanceof Error ? renderErr.message : "Design fill failed",
          );
        }
      }
      if (file) {
        if (data.id) {
          historyCache.putDetail(data.id, { ...data, ...designPatch }, null, file);
        }
        const items = await refreshHistory();
        if (data.id && items) {
          const summary = items.find((item) => item.id === data.id) ?? null;
          historyCache.putDetail(data.id, { ...data, ...designPatch }, summary, file);
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
      clearDesignState();
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

  async function handleApplyDesignVariables(variables: Record<string, unknown>) {
    if (!activeTemplateId) return;
    setBusyKind("convert");
    setLoading(true);
    try {
      const kind = activeTemplateKind ?? inferTemplateKind(activeTemplateId);
      const target = { id: activeTemplateId, kind };
      const rendered = await renderTarget(target, {
        markdown: "",
        format: "html",
        fill: "none",
        variables,
        envelope: true,
      });
      setRenderedHtml(rendered.html);
      setDesignMarkdown(rendered.markdown ?? null);
      setDesignContext(rendered.context ?? variables);
      setActiveTemplateKind(kind);
      setMarkdownMode("preview");
      setTemplateWarning(null);
      rememberDesignSession({
        documentId: result?.id ?? selectedId,
        templateId: activeTemplateId,
        templateName: activeTemplateName,
        templateKind: kind,
        html: rendered.html,
        markdown: rendered.markdown,
        context: rendered.context ?? variables,
      });
      await persistDesignOutput(result?.id ?? selectedId, {
        templateId: activeTemplateId,
        templateName: activeTemplateName,
        html: rendered.html,
        markdown: rendered.markdown,
        context: rendered.context ?? variables,
        returnFormat: returnFileType === "docx" ? "docx" : "pdf",
      });
    } catch (err) {
      setTemplateWarning(err instanceof Error ? err.message : "Could not re-render design");
    } finally {
      setLoading(false);
    }
  }

  async function handleDesignExport(format: "pdf" | "docx" | "html") {
    if (!activeTemplateId || !renderedHtml) {
      throw new Error("No design output to export");
    }
    const templateId = activeTemplateId.startsWith(BUILTIN_PREFIX)
      ? activeTemplateId.slice(BUILTIN_PREFIX.length)
      : activeTemplateId;
    const base = activeTemplateName || "design-output";
    if (format === "html") {
      downloadTextFile(renderedHtml, `${base}.html`, "text/html;charset=utf-8");
      return;
    }
    const kind = activeTemplateKind ?? inferTemplateKind(templateId);
    const fill = designContext ? "none" : "defaults";
    const rendered = await renderTarget(
      { id: templateId, kind },
      {
        markdown: designContext ? "" : markdownDraft || result?.markdown || "",
        variables: designContext || undefined,
        format,
        fill,
        envelope: false,
      },
    );
    if (format === "pdf") {
      if (!rendered.pdf) throw new Error("PDF export failed");
      downloadBlob(rendered.pdf, `${base}.pdf`);
      return;
    }
    if (!rendered.docx) throw new Error("DOCX export failed");
    downloadBlob(rendered.docx, `${base}.docx`);
  }

  function handleFileSelect(next: File | null) {
    if (uiLocked) return;
    setFile(next);
    setResult(null);
    setMarkdownDraft("");
    setMarkdownMode("preview");
    setError(null);
    clearDesignState();
    setSelectedId(null);
    setActiveRegionId(null);
  }

  async function handleSelectHistory(id: string) {
    if (uiLocked) return;
    const selectGen = ++historySelectGenRef.current;
    setError(null);
    setActiveRegionId(null);
    // Do not clear design before paint — that flashes Markdown while loading.
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
        clearDesignState();
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
        if (value === outputLayout) return;
        setOutputLayout(value);
        clearDesignState();
        // Design canvas exports PDF/DOCX only — never Markdown.
        if (value !== "standard" && returnFileType === "markdown") {
          setReturnFileType("pdf");
        }
      }}
      onReturnFileTypeChange={(value) => {
        if (outputLayout !== "standard" && value === "markdown") {
          setReturnFileType("pdf");
          return;
        }
        setReturnFileType(value);
      }}
    />
  );

  const produceAsDialog = produceAsOpen ? (
    <TargetFormatDialog
      outputLayout={outputLayout}
      designTargets={designTargets}
      templates={fillableTemplates.map((template) => ({ id: template.id, name: template.name }))}
      returnFileType={returnFileType}
      templateNeedsAi={hasTargetTemplate && !selectedTemplateStatic}
      wantsReadAi={Boolean(extractOptions.use_ai || extractOptions.target_lang)}
      onOutputLayoutChange={(value) => {
        if (value === outputLayout) return;
        setOutputLayout(value);
        clearDesignState();
        if (value !== "standard" && returnFileType === "markdown") {
          setReturnFileType("pdf");
        }
      }}
      onReturnFileTypeChange={(value) => {
        if (outputLayout !== "standard" && value === "markdown") {
          setReturnFileType("pdf");
          return;
        }
        setReturnFileType(value);
      }}
      onClose={() => setProduceAsOpen(false)}
    />
  ) : null;

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
            "grid min-h-0 min-w-0 flex-1 gap-3 overflow-hidden lg:gap-3",
            // Toggle rail stays far-left whenever any pane is closed.
            previewOpen &&
              historyOpen &&
              "grid-rows-[minmax(0,0.7fr)_minmax(0,0.85fr)_minmax(0,1.2fr)] [grid-template-areas:'history'_'source'_'result'] lg:grid-rows-1 lg:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)] lg:[grid-template-areas:'history_source_result']",
            previewOpen &&
              !historyOpen &&
              "grid-rows-[auto_minmax(0,1fr)_minmax(0,1.15fr)] [grid-template-areas:'toggles'_'source'_'result'] lg:grid-rows-1 lg:grid-cols-[2.75rem_minmax(0,1fr)_minmax(0,1fr)] lg:[grid-template-areas:'toggles_source_result']",
            !previewOpen &&
              historyOpen &&
              "grid-rows-[auto_minmax(0,0.75fr)_minmax(0,1.25fr)] [grid-template-areas:'toggles'_'history'_'result'] lg:grid-rows-1 lg:grid-cols-[2.75rem_220px_minmax(0,1fr)] lg:[grid-template-areas:'toggles_history_result']",
            !previewOpen &&
              !historyOpen &&
              "grid-rows-[auto_minmax(0,1fr)] [grid-template-areas:'toggles'_'result'] lg:grid-rows-1 lg:grid-cols-[2.75rem_minmax(0,1fr)] lg:[grid-template-areas:'toggles_result']",
          )}
        >
          {!historyOpen || !previewOpen ? (
            <div className="min-h-0 self-start [grid-area:toggles]">
              <WorkspacePaneToggles
                historyOpen={historyOpen}
                sourceOpen={previewOpen}
                sourceRef={showSourceRef}
                onToggleHistory={() => setHistoryOpen((open) => !open)}
                onToggleSource={() => {
                  setPreviewOpen((open) => {
                    if (open) {
                      restoreShowSourceFocusRef.current = true;
                    } else {
                      focusSourcePaneRef.current = true;
                    }
                    return !open;
                  });
                }}
              />
            </div>
          ) : null}

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
                onCollapse={() => {
                  restoreShowSourceFocusRef.current = true;
                  setPreviewOpen(false);
                }}
                actions={convertControls}
                intentName={intentDisplayName}
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
              renderedHtml={renderedHtml}
              templateId={activeTemplateId}
              templateName={activeTemplateName}
              templateWarning={templateWarning}
              designContext={designContext}
              intentName={intentDisplayName}
              onChooseIntent={() => setProduceAsOpen(true)}
              onApplyDesignVariables={activeTemplateId ? handleApplyDesignVariables : undefined}
              onDesignExport={activeTemplateId && renderedHtml ? handleDesignExport : undefined}
            />
          </div>
        </div>
        {produceAsDialog}
      </main>
      <SiteFooter compact />
    </div>
  );
}

/** Far-left global pane toggles — visible whenever History or Source is closed. */
function WorkspacePaneToggles({
  historyOpen,
  sourceOpen,
  sourceRef,
  onToggleHistory,
  onToggleSource,
}: {
  historyOpen: boolean;
  sourceOpen: boolean;
  sourceRef?: Ref<HTMLButtonElement>;
  onToggleHistory: () => void;
  onToggleSource: () => void;
}) {
  return (
    <nav
      aria-label="Workspace panes"
      className={cn(
        "flex h-10 w-full items-center justify-center gap-1 rounded-2xl border border-[var(--line)]",
        "bg-[color-mix(in_oklab,var(--bg-panel)_88%,transparent)] px-1.5",
        "lg:h-auto lg:w-full lg:flex-col lg:gap-1 lg:rounded-2xl lg:px-1 lg:py-1.5",
      )}
    >
      <PaneToggle
        pressed={historyOpen}
        ariaLabel={historyOpen ? "History" : "Show history"}
        title={historyOpen ? "Hide history" : "Show history"}
        controls="history-panel"
        onClick={onToggleHistory}
      >
        <Clock3 size={18} strokeWidth={1.7} aria-hidden />
      </PaneToggle>
      <PaneToggle
        ref={sourceRef}
        pressed={sourceOpen}
        ariaLabel={sourceOpen ? "Source" : "Show source"}
        title={sourceOpen ? "Hide source" : "Show source"}
        controls="source-preview-panel"
        onClick={onToggleSource}
      >
        <FileImage size={18} strokeWidth={1.7} aria-hidden />
      </PaneToggle>
    </nav>
  );
}

const PaneToggle = forwardRef<
  HTMLButtonElement,
  {
    pressed: boolean;
    ariaLabel: string;
    title: string;
    controls: string;
    onClick: () => void;
    children: ReactNode;
  }
>(function PaneToggle({ pressed, ariaLabel, title, controls, onClick, children }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      aria-pressed={pressed}
      aria-controls={controls}
      title={title}
      onClick={onClick}
      className={cn(
        "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.85rem] transition",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        pressed
          ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
          : "text-[var(--ink-muted)] hover:bg-[color-mix(in_oklab,var(--ink)_5%,transparent)] hover:text-[var(--ink)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0.5 top-1/2 h-3 w-[2px] -translate-y-1/2 rounded-full bg-[var(--accent)] transition",
          pressed ? "opacity-100" : "opacity-0",
        )}
      />
      {children}
    </button>
  );
});
