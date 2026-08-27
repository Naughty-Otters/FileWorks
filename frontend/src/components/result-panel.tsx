"use client";

import {
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
  Eye,
  FileOutput,
  Loader2,
  Boxes,
  Pencil,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  downloadTextFile,
  exportMarkdownFile,
  getApiBase,
  type DownloadFormat,
  type ExtractResponse,
  type RegionBox,
} from "@/lib/api";
import { applyMarkdownFormat, type FormatCommand, type FormatExtra } from "@/lib/markdown-format";
import { joinLines, lineRangeForPages, PAGES_PER_VIEW, replaceLineRange, splitLines } from "@/lib/markdown-pages";
import { cn } from "@/lib/utils";
import { PRODUCT, targetEmptyTitle } from "@/lib/product-copy";
import { EditableMarkdownPreview, type MarkdownPreviewHandle } from "@/components/editable-markdown-preview";
import { MarkdownToolbar, MarkdownToolbarToggle } from "@/components/markdown-toolbar";
import { RegionList } from "@/components/region-overlay";

type ResultPanelProps = {
  result: ExtractResponse | null;
  loading: boolean;
  busyLabel?: string;
  busyHint?: string | null;
  error: string | null;
  view: "markdown" | "json";
  onViewChange: (view: "markdown" | "json") => void;
  activeRegionId?: string | null;
  onActiveRegionChange?: (id: string | null) => void;
  markdownDraft?: string;
  onMarkdownChange?: (value: string) => void;
  markdownMode?: "preview" | "edit";
  onMarkdownModeChange?: (mode: "preview" | "edit") => void;
  toolbarVisible?: boolean;
  onToolbarVisibleChange?: (visible: boolean) => void;
  actions?: ReactNode;
  leadingToggle?: ReactNode;
  trailingToggle?: ReactNode;
  renderedHtml?: string | null;
  templateId?: string | null;
  templateName?: string | null;
  templateWarning?: string | null;
  designContext?: Record<string, unknown> | null;
  onApplyDesignVariables?: (variables: Record<string, unknown>) => void;
  /** Export filled design from the canvas (not from source Markdown). */
  onDesignExport?: (format: "pdf" | "docx" | "html") => Promise<void>;
  /** Empty-state Intent name (Markdown when null). */
  intentName?: string | null;
  onChooseIntent?: () => void;
};

const SOURCE_DOWNLOAD_OPTIONS: Array<{ id: DownloadFormat | "pdf"; label: string }> = [
  { id: "markdown", label: "Markdown (.md)" },
  { id: "txt", label: "Plain text (.txt)" },
  { id: "html", label: "HTML (.html)" },
  { id: "json", label: "JSON (.json)" },
  { id: "docx", label: "Word (.docx)" },
  { id: "pdf", label: "PDF" },
];

const DESIGN_DOWNLOAD_OPTIONS: Array<{ id: "pdf" | "docx" | "html"; label: string }> = [
  { id: "pdf", label: "PDF" },
  { id: "docx", label: "Word (.docx)" },
  { id: "html", label: "HTML (.html)" },
];

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** Counts up while a run is active and resets when it ends. */
function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => {
      window.clearInterval(timer);
      setSeconds(0);
    };
  }, [active]);

  return seconds;
}

export function ResultPanel({
  result,
  loading,
  busyLabel = "Converting your file…",
  busyHint = "Use Stop to cancel",
  error,
  view,
  onViewChange,
  activeRegionId = null,
  onActiveRegionChange,
  markdownDraft,
  onMarkdownChange,
  markdownMode = "preview",
  onMarkdownModeChange,
  toolbarVisible = true,
  onToolbarVisibleChange,
  actions,
  leadingToggle,
  trailingToggle,
  renderedHtml = null,
  templateId = null,
  templateName = null,
  templateWarning = null,
  designContext = null,
  onApplyDesignVariables,
  onDesignExport,
  intentName = null,
  onChooseIntent,
}: ResultPanelProps) {
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [regionsOpen, setRegionsOpen] = useState(false);
  const [pageStart, setPageStart] = useState(0);
  const [variablesDraft, setVariablesDraft] = useState("");
  const [variablesError, setVariablesError] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"design" | "source" | "variables" | "json">("design");
  const previewRef = useRef<MarkdownPreviewHandle>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const elapsed = useElapsedSeconds(loading);

  const sourceMarkdown = result?.markdown?.trim() || "";
  const markdown = markdownDraft || sourceMarkdown;
  const regions: RegionBox[] = result?.regions || [];
  const jsonText = useMemo(() => {
    if (!result) return "";
    const payload = result.structure ?? result.json ?? { pages: result.pages };
    return JSON.stringify(payload, null, 2);
  }, [result]);
  const pagedText = view === "json" ? jsonText : markdown;
  const pagedLines = useMemo(() => splitLines(pagedText), [pagedText]);
  const { startPage, endPage, lineStart, lineEnd, pageCount } = lineRangeForPages(
    pageStart,
    pagedLines,
  );
  const visibleText = joinLines(pagedLines.slice(lineStart, lineEnd));
  const paginated = pageCount > PAGES_PER_VIEW;

  const hasFilled = Boolean(renderedHtml && templateId);

  useEffect(() => {
    setDownloadOpen(false);
    setPageStart(0);
    setExportError(null);
  }, [result?.id, result?.filename, view]);

  useEffect(() => {
    if (designContext) {
      setVariablesDraft(JSON.stringify(designContext, null, 2));
      setVariablesError(null);
    }
  }, [designContext, result?.id]);

  useEffect(() => {
    if (hasFilled) setPanelTab("design");
  }, [hasFilled, result?.id, renderedHtml]);

  function applyVisibleMarkdown(nextSlice: string) {
    if (!onMarkdownChange) return;
    onMarkdownChange(replaceLineRange(markdown, lineStart, lineEnd, nextSlice));
  }

  const content = view === "markdown" ? markdown : jsonText;
  const empty = !hasFilled && !loading && !error && !content && regions.length === 0;

  async function handleSourceDownload(format: DownloadFormat | "pdf") {
    if (!markdown) return;
    setExporting(true);
    setDownloadOpen(false);
    setExportError(null);
    try {
      const base = (result?.filename || "document").replace(/\.[^.]+$/, "") || "document";
      if (format === "pdf") {
        const htmlRes = await fetch(`${getApiBase()}/api/export`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            markdown,
            format: "html",
            filename: base,
            document_id: result?.id || undefined,
            structure: result?.structure || undefined,
          }),
        });
        const html = htmlRes.ok ? await htmlRes.text() : `<pre>${markdown}</pre>`;
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(html);
          win.document.close();
          win.focus();
          window.setTimeout(() => win.print(), 300);
        }
        return;
      }
      try {
        await exportMarkdownFile(markdown, format, base, {
          documentId: result?.id,
          structure:
            format === "html" || format === "json" || format === "docx"
              ? ((result?.structure as Record<string, unknown> | null | undefined) ?? null)
              : null,
        });
      } catch {
        if (format === "markdown") {
          downloadTextFile(markdown, `${base}.md`, "text/markdown;charset=utf-8");
        } else if (format === "txt") {
          downloadTextFile(markdown, `${base}.txt`, "text/plain;charset=utf-8");
        } else if (format === "json") {
          downloadTextFile(
            JSON.stringify({ markdown, filename: base }, null, 2),
            `${base}.json`,
            "application/json;charset=utf-8",
          );
        } else if (format === "html") {
          downloadTextFile(
            `<!DOCTYPE html><html><body><pre>${markdown
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")}</pre></body></html>`,
            `${base}.html`,
            "text/html;charset=utf-8",
          );
        }
      }
    } finally {
      setExporting(false);
    }
  }

  async function handleDesignDownload(format: "pdf" | "docx" | "html") {
    if (!onDesignExport) return;
    setExporting(true);
    setDownloadOpen(false);
    setExportError(null);
    try {
      await onDesignExport(format);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Design export failed");
    } finally {
      setExporting(false);
    }
  }

  const resultTab =
    view === "json"
      ? "json"
      : panelTab === "variables"
        ? "variables"
        : hasFilled && panelTab === "design"
          ? "filled"
          : panelTab === "source" || (!hasFilled && markdownMode === "edit")
            ? "source"
            : hasFilled
              ? "filled"
              : "markdown";

  function setResultTab(tab: "filled" | "markdown" | "source" | "json" | "variables") {
    if (tab === "json") {
      setPanelTab("json");
      onViewChange("json");
      return;
    }
    onViewChange("markdown");
    if (tab === "variables") {
      setPanelTab("variables");
      return;
    }
    if (tab === "filled") {
      setPanelTab("design");
      onMarkdownModeChange?.("preview");
      return;
    }
    if (tab === "source") {
      setPanelTab("source");
      onMarkdownModeChange?.("edit");
      return;
    }
    // Preview (Markdown convert path)
    setPanelTab("design");
    onMarkdownModeChange?.("preview");
  }

  function applyVariables() {
    if (!onApplyDesignVariables) return;
    try {
      const parsed = JSON.parse(variablesDraft || "{}") as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setVariablesError("Variables must be a JSON object.");
        return;
      }
      setVariablesError(null);
      onApplyDesignVariables(parsed as Record<string, unknown>);
    } catch (err) {
      setVariablesError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  function handleFormatCommand(command: FormatCommand, extra?: FormatExtra) {
    if (!onMarkdownChange) return;
    if (markdownMode === "preview") {
      if (previewRef.current) {
        previewRef.current.applyCommand(command, extra);
        return;
      }
    }
    const field = sourceRef.current;
    const selStart = field?.selectionStart ?? visibleText.length;
    const selEnd = field?.selectionEnd ?? visibleText.length;
    const next = applyMarkdownFormat(visibleText, selStart, selEnd, command, extra);
    applyVisibleMarkdown(next.value);
    window.requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(next.start, next.end);
    });
  }

  const showToolbar =
    view === "markdown" &&
    Boolean(markdown) &&
    !loading &&
    !error &&
    resultTab !== "filled" &&
    resultTab !== "variables";

  const downloadOptions = hasFilled ? DESIGN_DOWNLOAD_OPTIONS : SOURCE_DOWNLOAD_OPTIONS;
  const canDownload = hasFilled ? Boolean(onDesignExport) : Boolean(markdown);

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="panel relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--line)] px-2.5">
          {leadingToggle}
          {onChooseIntent ? (
            <button
              type="button"
              aria-label={intentName ? `${PRODUCT.produceAs}: ${intentName}` : PRODUCT.produceAs}
              aria-haspopup="dialog"
              title={PRODUCT.chooseTarget}
              onClick={onChooseIntent}
              className={cn(
                "inline-flex h-8 min-w-0 max-w-[min(14rem,45%)] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
                "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]",
                "hover:bg-[color-mix(in_oklab,var(--accent-soft)_80%,var(--accent)_12%)]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
              )}
            >
              <FileOutput size={14} className="shrink-0" aria-hidden />
              <span className="truncate">{intentName || "Markdown"}</span>
            </button>
          ) : (
            <FileOutput size={15} className="shrink-0 text-[var(--accent)]" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight text-[var(--ink)]">
              {templateName || result?.filename || "Target"}
            </p>
            <p className="truncate text-[11px] leading-tight text-[var(--ink-muted)]">
              {result
                ? `${result.page_count} page${result.page_count === 1 ? "" : "s"}`
                : intentName
                  ? `Ready for ${intentName}`
                  : PRODUCT.chooseDesign}
            </p>
          </div>
          {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
          {showToolbar ? (
            <MarkdownToolbarToggle
              pressed={toolbarVisible}
              onToggle={() => onToolbarVisibleChange?.(!toolbarVisible)}
            />
          ) : null}
          <div
            className="inline-flex rounded-full border border-[var(--line)] bg-[var(--bg)] p-0.5"
            role="tablist"
            aria-label="Result view"
          >
            {(
              (
                hasFilled
                  ? ([
                      { id: "filled", label: "Design", icon: Eye },
                      { id: "source", label: "Source", icon: Pencil },
                      { id: "variables", label: "Variables", icon: Boxes },
                      { id: "json", label: "JSON", icon: Code2 },
                    ] as const)
                  : ([
                      { id: "markdown", label: "Preview", icon: Eye },
                      { id: "source", label: "Source", icon: Pencil },
                      { id: "json", label: "JSON", icon: Code2 },
                    ] as const)
              )
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-label={tab.label}
                aria-selected={resultTab === tab.id}
                title={tab.label}
                onClick={() => setResultTab(tab.id)}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full transition",
                  resultTab === tab.id
                    ? "bg-[var(--accent)] text-white dark:text-[#06281d]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
                )}
              >
                <tab.icon size={13} aria-hidden />
              </button>
            ))}
          </div>
          <div className="relative">
            <button
              type="button"
              disabled={!canDownload || exporting}
              aria-label="Download"
              onClick={() => setDownloadOpen((v) => !v)}
              className="rounded-full p-1.5 text-[var(--ink-muted)] transition enabled:hover:bg-[var(--accent-soft)] enabled:hover:text-[var(--accent-strong)] disabled:opacity-40"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            </button>
            {downloadOpen ? (
              <div className="absolute right-0 z-20 mt-1 min-w-[180px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] shadow-[var(--shadow)]">
                {downloadOptions.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs text-[var(--ink)] transition hover:bg-[var(--accent-soft)]"
                    onClick={() => {
                      if (hasFilled) {
                        void handleDesignDownload(opt.id as "pdf" | "docx" | "html");
                      } else {
                        void handleSourceDownload(opt.id as DownloadFormat | "pdf");
                      }
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {trailingToggle}
        </div>

        {exportError ? (
          <p className="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-800">
            {exportError}
          </p>
        ) : null}

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-2xl">
          {showToolbar && toolbarVisible ? (
            <MarkdownToolbar
              disabled={!onMarkdownChange}
              onCommand={handleFormatCommand}
            />
          ) : null}
          {loading ? (
            <>
              <div
                role="progressbar"
                aria-label={busyLabel}
                className="progress-indeterminate h-0.5 w-full shrink-0"
              />
              <div
                aria-live="polite"
                aria-busy
                className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-[var(--ink-muted)]"
              >
                <Loader2 size={28} className="animate-spin text-[var(--accent)]" />
                <p className="animate-pulse-soft text-sm">{busyLabel}</p>
                <p className="text-xs tabular-nums text-[var(--ink-muted)]">
                  {[elapsed > 0 ? `${formatElapsed(elapsed)} elapsed` : null, busyHint]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </>
          ) : error ? (
            <div className="flex min-h-0 flex-1 items-center justify-center px-8 text-center">
              <p className="max-w-md text-sm text-[var(--danger)]">{error}</p>
            </div>
          ) : hasFilled && resultTab === "filled" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#e8ece9]">
              {templateWarning ? (
                <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  {templateWarning}
                </p>
              ) : null}
              {/* iframe isolates design <style> (html/body background) from the app shell */}
              <iframe
                title={templateName ? `${templateName} design` : "Filled design"}
                srcDoc={renderedHtml || ""}
                sandbox=""
                className="min-h-0 w-full flex-1 border-0 bg-[#e8ece9]"
              />
            </div>
          ) : hasFilled && resultTab === "variables" ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
              <p className="text-[11px] text-[var(--ink-muted)]">
                Edit filled variables and re-render without re-running AI extract.
              </p>
              <textarea
                value={variablesDraft}
                onChange={(e) => setVariablesDraft(e.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 resize-none rounded-xl border border-[var(--line)] bg-[var(--bg)] p-3 font-mono text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]"
              />
              {variablesError ? (
                <p className="text-xs text-[var(--danger)]">{variablesError}</p>
              ) : null}
              <button
                type="button"
                disabled={!onApplyDesignVariables || loading}
                onClick={applyVariables}
                className="self-start rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)] disabled:opacity-40"
              >
                Apply variables
              </button>
            </div>
          ) : empty ? (
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] overflow-y-auto px-5 py-6 text-center sm:px-8">
              <div className="flex min-h-0 flex-col items-center justify-end pb-5">
                <div className="min-w-0 w-full max-w-sm space-y-2">
                <p className="font-[family-name:var(--font-display)] text-xl tracking-tight text-[var(--ink)]">
                  {targetEmptyTitle(intentName)}
                </p>
                <p className="text-xs leading-relaxed text-[var(--ink-muted)]">
                  {intentName
                    ? "Source is ready on the left. Press Fill when you are."
                    : PRODUCT.targetEmptyHint}
                </p>
                </div>
              </div>
              <div className="flex justify-center">
                {onChooseIntent ? (
                  <button
                    type="button"
                    onClick={onChooseIntent}
                    className={cn(
                      "inline-flex w-full max-w-sm min-w-0 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition",
                      "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]",
                      "hover:bg-[color-mix(in_oklab,var(--accent-soft)_80%,var(--accent)_12%)]",
                    )}
                  >
                    <FileOutput size={16} className="shrink-0" aria-hidden />
                    <span className="min-w-0 truncate">
                      {intentName ? PRODUCT.changeDesign : PRODUCT.chooseDesign}
                    </span>
                  </button>
                ) : (
                  <div className="h-[46px] w-full max-w-sm" aria-hidden />
                )}
              </div>
              <div className="min-h-0" aria-hidden />
            </div>
          ) : view === "markdown" && resultTab === "source" ? (
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              {templateWarning && !renderedHtml ? (
                <p className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  {templateWarning}
                </p>
              ) : null}
              <textarea
                key={`${lineStart}-${lineEnd}`}
                ref={sourceRef}
                value={visibleText}
                onChange={(e) => applyVisibleMarkdown(e.target.value)}
                spellCheck={false}
                className="min-h-0 flex-1 w-full resize-none overflow-auto border-0 bg-transparent p-5 font-[family-name:var(--font-mono)] text-[13px] leading-relaxed text-[var(--ink)] outline-none md:p-6"
                placeholder="Edit Markdown source…"
              />
            </div>
          ) : view === "markdown" && !hasFilled ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              <EditableMarkdownPreview
                key={`${lineStart}-${lineEnd}`}
                ref={previewRef}
                markdown={visibleText}
                onChange={onMarkdownChange ? applyVisibleMarkdown : undefined}
              />
            </div>
          ) : (
            <pre
              key={`${lineStart}-${lineEnd}`}
              className="min-h-0 flex-1 overflow-auto p-5 font-[family-name:var(--font-mono)] text-[12.5px] leading-relaxed text-[var(--ink)] md:p-6"
            >
              <code className="animate-rise">{visibleText}</code>
            </pre>
          )}
          {paginated && !loading && !error && !empty && resultTab !== "filled" ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--line)] px-3 py-2">
              <p className="min-w-0 text-[11px] text-[var(--ink-muted)]">
                Pages {startPage + 1}–{endPage} of {pageCount}
              </p>
              <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ink-muted)]">
                <span className="sr-only sm:not-sr-only">Go to</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={pageCount}
                  aria-label="Go to page"
                  placeholder="#"
                  className="h-7 w-12 rounded-full border border-[var(--line)] bg-[var(--bg)] px-2 text-center text-[11px] text-[var(--ink)] outline-none focus:border-[var(--accent)]"
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const raw = Number((event.target as HTMLInputElement).value);
                    if (!Number.isFinite(raw)) return;
                    const page = Math.max(1, Math.min(pageCount, Math.floor(raw)));
                    setPageStart(Math.floor((page - 1) / PAGES_PER_VIEW) * PAGES_PER_VIEW);
                    (event.target as HTMLInputElement).value = String(page);
                  }}
                  onBlur={(event) => {
                    const raw = Number(event.target.value);
                    if (!Number.isFinite(raw) || event.target.value.trim() === "") {
                      event.target.value = "";
                      return;
                    }
                    const page = Math.max(1, Math.min(pageCount, Math.floor(raw)));
                    setPageStart(Math.floor((page - 1) / PAGES_PER_VIEW) * PAGES_PER_VIEW);
                    event.target.value = String(page);
                  }}
                />
              </label>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  disabled={startPage === 0}
                  onClick={() => setPageStart(Math.max(0, startPage - PAGES_PER_VIEW))}
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] text-[var(--ink-muted)] transition enabled:hover:bg-[var(--accent-soft)] enabled:hover:text-[var(--accent-strong)] disabled:opacity-40"
                >
                  <ChevronLeft size={12} />
                  Previous
                </button>
                <button
                  type="button"
                  disabled={endPage >= pageCount}
                  onClick={() => setPageStart(startPage + PAGES_PER_VIEW)}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1 text-[11px] font-medium text-white transition enabled:hover:opacity-90 disabled:opacity-40 dark:text-[#06281d]"
                >
                  Next
                  <ChevronRight size={12} />
                </button>
              </div>
            </div>
          ) : null}
        </div>
        {regions.length > 0 ? (
          <div className="shrink-0 border-t border-[var(--line)]">
            <button
              type="button"
              aria-expanded={regionsOpen}
              onClick={() => setRegionsOpen((open) => !open)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--ink-muted)] transition hover:bg-[color-mix(in_oklab,var(--accent-soft)_40%,transparent)]"
            >
              <Boxes size={13} className="text-[var(--accent)]" />
              {regions.length} recognized region{regions.length === 1 ? "" : "s"}
              <span className="ml-auto">{regionsOpen ? "Hide" : "Show"}</span>
            </button>
            {regionsOpen ? (
              <div className="max-h-32 overflow-auto border-t border-[var(--line)] p-2">
                <RegionList
                  regions={regions}
                  activeId={activeRegionId}
                  onActiveChange={onActiveRegionChange || (() => undefined)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
