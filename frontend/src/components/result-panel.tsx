"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
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
  renderTemplate,
  type DownloadFormat,
  type ExtractResponse,
  type RegionBox,
} from "@/lib/api";
import { applyMarkdownFormat, type FormatCommand, type FormatExtra } from "@/lib/markdown-format";
import { joinLines, lineRangeForPages, PAGES_PER_VIEW, replaceLineRange, splitLines } from "@/lib/markdown-pages";
import { cn } from "@/lib/utils";
import { EditableMarkdownPreview, type MarkdownPreviewHandle } from "@/components/editable-markdown-preview";
import { MarkdownToolbar, ShowMarkdownToolbarButton } from "@/components/markdown-toolbar";
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
  templateReturnFileType?: "markdown" | "docx" | "pdf";
  onUpdateFilledFromSource?: () => void;
};

const DOWNLOAD_OPTIONS: Array<{ id: DownloadFormat | "pdf"; label: string }> = [
  { id: "markdown", label: "Markdown (.md)" },
  { id: "txt", label: "Plain text (.txt)" },
  { id: "html", label: "HTML (.html)" },
  { id: "json", label: "JSON (.json)" },
  { id: "docx", label: "Word (.docx)" },
  { id: "pdf", label: "PDF (print)" },
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
  templateReturnFileType = "docx",
  onUpdateFilledFromSource,
}: ResultPanelProps) {
  const [copied, setCopied] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [regionsOpen, setRegionsOpen] = useState(false);
  const [pageStart, setPageStart] = useState(0);
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

  useEffect(() => {
    setDownloadOpen(false);
    setPageStart(0);
  }, [result?.id, result?.filename, view]);

  function applyVisibleMarkdown(nextSlice: string) {
    if (!onMarkdownChange) return;
    onMarkdownChange(replaceLineRange(markdown, lineStart, lineEnd, nextSlice));
  }

  const content = view === "markdown" ? markdown : jsonText;
  const empty = !loading && !error && !content && regions.length === 0;

  async function copyContent() {
    if (!content) return;
    await navigator.clipboard.writeText(content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  async function handleDownload(format: DownloadFormat | "pdf") {
    if (!markdown) return;
    setExporting(true);
    setDownloadOpen(false);
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
        // Client-side fallback
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

  async function handleTemplateDownload() {
    if (!templateId) return;
    setExporting(true);
    try {
      const base = templateName || "design-output";
      if (templateReturnFileType === "pdf") {
        const win = window.open("", "_blank");
        if (win) {
          win.document.write(renderedHtml || "<p>No preview available.</p>");
          win.document.close();
          win.focus();
          window.setTimeout(() => win.print(), 300);
        }
        return;
      }
      const fill = markdown.trim() ? "auto" : "defaults";
      if (templateReturnFileType === "markdown") {
        const rendered = await renderTemplate(templateId, {
          markdown,
          format: "markdown",
          fill,
        });
        downloadTextFile(
          rendered.markdown || "",
          `${base}.md`,
          "text/markdown;charset=utf-8",
        );
        return;
      }
      const rendered = await renderTemplate(templateId, {
        markdown,
        format: "docx",
        fill,
      });
      if (!rendered.docx) throw new Error("The render endpoint did not return a DOCX file");
      const url = URL.createObjectURL(rendered.docx);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${base}.docx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const hasFilled = Boolean(renderedHtml && templateId);
  const resultTab =
    view === "json"
      ? "json"
      : hasFilled && markdownMode === "preview"
        ? "filled"
        : markdownMode === "edit"
          ? "source"
          : "markdown";

  function setResultTab(tab: "filled" | "markdown" | "source" | "json") {
    if (tab === "json") {
      onViewChange("json");
      return;
    }
    onViewChange("markdown");
    if (tab === "filled") {
      onMarkdownModeChange?.("preview");
      return;
    }
    if (tab === "source") {
      onMarkdownModeChange?.("edit");
      return;
    }
    onMarkdownModeChange?.("preview");
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
    resultTab !== "filled";

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="panel relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-t-2xl border-b border-[var(--line)] px-3 py-2">
          {leadingToggle}
          <FileOutput size={15} className="shrink-0 text-[var(--accent)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{templateName || result?.filename || "Converted file"}</p>
            <p className="truncate text-[11px] text-[var(--ink-muted)]">
              {result
                ? `${result.page_count} page${result.page_count === 1 ? "" : "s"}`
                : "Markdown lands here after convert"}
            </p>
          </div>
          {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
          {hasFilled ? (
            <button
              type="button"
              disabled={exporting}
              title={
                templateReturnFileType === "pdf"
                  ? "Print the filled preview as PDF"
                  : "Export filled document (may use 1 AI credit to refresh fill)"
              }
              onClick={handleTemplateDownload}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
            >
              <Download size={12} />
              {templateReturnFileType === "markdown"
                ? "MD"
                : templateReturnFileType.toUpperCase()}
            </button>
          ) : null}
          {hasFilled && onUpdateFilledFromSource ? (
            <button
              type="button"
              disabled={exporting || loading || !markdown.trim()}
              onClick={onUpdateFilledFromSource}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)] disabled:opacity-40"
            >
              Update from source
            </button>
          ) : null}
          {showToolbar && !toolbarVisible ? (
            <ShowMarkdownToolbarButton onClick={() => onToolbarVisibleChange?.(true)} />
          ) : null}
          <div className="inline-flex rounded-full border border-[var(--line)] bg-[var(--bg)] p-0.5">
            {(
              (
                hasFilled
                  ? ([
                      { id: "filled", label: "Filled", icon: Eye },
                      { id: "source", label: "Source", icon: Pencil },
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
                title={tab.label}
                onClick={() => setResultTab(tab.id)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition",
                  resultTab === tab.id
                    ? "bg-[var(--accent)] text-white dark:text-[#06281d]"
                    : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
                )}
              >
                <tab.icon size={12} />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
          <div className="relative">
            <button
              type="button"
              disabled={!markdown || exporting}
              aria-label="Download"
              onClick={() => setDownloadOpen((v) => !v)}
              className="rounded-full p-1.5 text-[var(--ink-muted)] transition enabled:hover:bg-[var(--accent-soft)] enabled:hover:text-[var(--accent-strong)] disabled:opacity-40"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            </button>
            {downloadOpen ? (
              <div className="absolute right-0 z-20 mt-1 min-w-[180px] overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-elevated)] shadow-[var(--shadow)]">
                {DOWNLOAD_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs text-[var(--ink)] transition hover:bg-[var(--accent-soft)]"
                    onClick={() => handleDownload(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            disabled={!content}
            aria-label={copied ? "Copied" : "Copy"}
            onClick={copyContent}
            className="rounded-full p-1.5 text-[var(--ink-muted)] transition enabled:hover:bg-[var(--accent-soft)] enabled:hover:text-[var(--accent-strong)] disabled:opacity-40"
          >
            {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
          </button>
          {trailingToggle}
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-b-2xl">
          {showToolbar && toolbarVisible ? (
            <MarkdownToolbar
              disabled={!onMarkdownChange}
              onCommand={handleFormatCommand}
              onHide={() => onToolbarVisibleChange?.(false)}
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
            <div className="min-h-0 flex-1 overflow-auto bg-white text-slate-900">
              {templateWarning ? (
                <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
                  {templateWarning}
                </p>
              ) : null}
              <div className="p-5" dangerouslySetInnerHTML={{ __html: renderedHtml || "" }} />
            </div>
          ) : empty ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center text-[var(--ink-muted)]">
              <FileOutput size={28} className="opacity-50" />
              <p className="max-w-sm text-sm">Drop a file and convert — editable Markdown lands here.</p>
            </div>
          ) : view === "markdown" && markdownMode === "preview" && !hasFilled ? (
            <div className="min-h-0 flex-1 overflow-hidden">
              <EditableMarkdownPreview
                key={`${lineStart}-${lineEnd}`}
                ref={previewRef}
                markdown={visibleText}
                onChange={onMarkdownChange ? applyVisibleMarkdown : undefined}
              />
            </div>
          ) : view === "markdown" && (markdownMode === "edit" || resultTab === "source") ? (
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
          ) : (
            <pre
              key={`${lineStart}-${lineEnd}`}
              className="min-h-0 flex-1 overflow-auto p-5 font-[family-name:var(--font-mono)] text-[12.5px] leading-relaxed text-[var(--ink)] md:p-6"
            >
              <code className="animate-rise">{visibleText}</code>
            </pre>
          )}
          {paginated && !loading && !error && !empty && resultTab !== "filled" ? (
            <div className="flex shrink-0 items-center gap-2 border-t border-[var(--line)] px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-[11px] text-[var(--ink-muted)]">
                Pages {startPage + 1}–{endPage} of {pageCount}
              </p>
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
                Show next pages
                <ChevronRight size={12} />
              </button>
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
