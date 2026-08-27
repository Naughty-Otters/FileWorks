"use client";

import { FileImage, FilePlus, FileText, PanelLeftClose, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { ImageSize, RegionBox } from "@/lib/api";
import { PRODUCT } from "@/lib/product-copy";
import { cn, formatBytes } from "@/lib/utils";
import { AnnotatedImage } from "@/components/region-overlay";
import { canOfferEditor, isPageStampFile, isTextEditorFile, TEXT_FILE_EXTENSIONS } from "@/lib/editor-files";
import { isWordDocxFile } from "@/lib/docx-to-editor";

type UploadPanelProps = {
  file: File | null;
  previewUrl: string | null;
  disabled?: boolean;
  regions?: RegionBox[];
  imageSize?: ImageSize | null;
  activeRegionId?: string | null;
  onActiveRegionChange?: (id: string | null) => void;
  onFileSelect: (file: File | null) => void;
  onCollapse?: () => void;
  /** Open this PDF/image in Editor without converting. */
  onEditText?: () => void;
  /** Pipeline actions (Produce as · Options · Convert) — lives in the single Source chrome. */
  actions?: ReactNode;
  leadingToggle?: ReactNode;
  /** When set, empty dropzone invites filling this Design. */
  intentName?: string | null;
};

const ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "application/pdf",
  "text/*",
  "application/json",
  "application/xml",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
  ".epub",
  ...TEXT_FILE_EXTENSIONS,
].join(",");

function ToolbarDivider() {
  return <span className="mx-0.5 hidden h-4 w-px shrink-0 bg-[var(--line)] sm:block" aria-hidden />;
}

export function UploadPanel({
  file,
  previewUrl,
  disabled,
  regions = [],
  imageSize = null,
  activeRegionId = null,
  onActiveRegionChange,
  onFileSelect,
  onCollapse,
  onEditText,
  actions,
  leadingToggle,
  intentName = null,
}: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [textPreview, setTextPreview] = useState<string | null>(null);
  const isPdf = file?.type === "application/pdf" || file?.name.toLowerCase().endsWith(".pdf");
  const isText = Boolean(
    file &&
      (/\.(txt|md|markdown)$/i.test(file.name) ||
        file.type === "text/plain" ||
        file.type === "text/markdown" ||
        file.type === "text/x-markdown"),
  );

  useEffect(() => {
    if (!file || !isText) {
      setTextPreview(null);
      return;
    }
    let cancelled = false;
    void file.text().then((text) => {
      if (!cancelled) setTextPreview(text);
    });
    return () => {
      cancelled = true;
    };
  }, [file, isText]);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      const next = list?.[0];
      if (next) onFileSelect(next);
    },
    [onFileSelect],
  );

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (!disabled) handleFiles(e.dataTransfer.files);
    },
  };

  const meta = dragging && file
    ? "Drop to replace"
    : file
      ? `${formatBytes(file.size)}${regions.length > 0 ? ` · ${regions.length} regions` : ""}`
      : intentName
        ? `Ready to fill ${intentName}`
        : "Drop a file to begin";

  return (
    <section className="flex h-full min-h-0 flex-col">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <div
        {...(file ? dropHandlers : {})}
        className={cn(
          "panel relative flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-2xl",
          file && dragging && "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)]",
        )}
      >
        {/* One Source chrome: identity · source tools · pipeline · panel */}
        <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-[var(--line)] px-2.5">
          {leadingToggle}

          <div className="flex min-w-0 flex-1 items-center gap-2">
            {file ? (
              isPdf || isText ? (
                <FileText size={15} className="shrink-0 text-[var(--accent)]" aria-hidden />
              ) : (
                <FileImage size={15} className="shrink-0 text-[var(--accent)]" aria-hidden />
              )
            ) : (
              <Upload size={15} className="shrink-0 text-[var(--accent)]" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight text-[var(--ink)]">
                {file ? file.name : "Source"}
              </p>
              <p className="truncate text-[11px] leading-tight text-[var(--ink-muted)]">{meta}</p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {file ? (
              <button
                type="button"
                disabled={disabled}
                aria-label="New source"
                title="Clear and start with a new source"
                onClick={() => onFileSelect(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:opacity-50"
              >
                <FilePlus size={14} aria-hidden />
              </button>
            ) : null}

            {actions ? (
              <>
                {file ? <ToolbarDivider /> : null}
                {actions}
              </>
            ) : null}

            {onCollapse ? (
              <>
                <ToolbarDivider />
                <button
                  type="button"
                  aria-label="Hide source"
                  aria-expanded={true}
                  aria-controls="source-preview-panel"
                  title="Hide source panel"
                  onClick={onCollapse}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <PanelLeftClose size={14} aria-hidden />
                </button>
              </>
            ) : null}
          </div>
        </header>

        {!file ? (
          <div
            className={cn(
              "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] overflow-y-auto px-5 py-6 text-center sm:px-8",
              dragging ? "bg-[var(--accent-soft)]" : "",
              disabled && "pointer-events-none opacity-60",
            )}
            {...dropHandlers}
          >
            <div className="flex min-h-0 flex-col items-center justify-end pb-5">
              <div className="min-w-0 w-full max-w-sm space-y-2">
                <p className="font-[family-name:var(--font-display)] text-xl tracking-tight text-[var(--ink)]">
                  {PRODUCT.homeLine}
                </p>
                <p className="text-xs leading-relaxed text-[var(--ink-muted)]">
                  {intentName
                    ? `Then fill ${intentName} from this file.`
                    : PRODUCT.sourceEmptyHint}
                </p>
              </div>
            </div>

            <div className="flex justify-center">
              <button
                type="button"
                aria-label="Upload document"
                onClick={openPicker}
                className={cn(
                  "inline-flex w-full max-w-sm min-w-0 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition",
                  "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)] hover:bg-[color-mix(in_oklab,var(--accent-soft)_80%,var(--accent)_12%)]",
                )}
              >
                <Upload size={16} className="shrink-0" aria-hidden />
                <span className="min-w-0 truncate">
                  {intentName ? `Choose file for ${intentName}` : PRODUCT.dropOrChoose}
                </span>
              </button>
            </div>

            <div className="flex min-h-0 flex-col items-center justify-start pt-5">
              <p className="max-w-sm text-[11px] leading-relaxed text-[var(--ink-muted)]">
                Word, Excel, PowerPoint, PDF, Markdown, TXT, CSV, images · up to 50MB
              </p>
            </div>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1 overflow-hidden bg-[color-mix(in_oklab,var(--bg)_80%,black_4%)] p-3">
            {isPdf ? (
              <iframe
                title="PDF preview"
                src={previewUrl ?? undefined}
                className="h-full min-h-0 w-full rounded-xl border border-[var(--line)] bg-white"
              />
            ) : isText ? (
              <pre className="h-full min-h-0 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-sm leading-6 text-[var(--ink)]">
                {textPreview ?? "Loading…"}
              </pre>
            ) : previewUrl ? (
              <div className="flex h-full min-h-0 items-center justify-center overflow-hidden">
                <AnnotatedImage
                  src={previewUrl}
                  alt={file.name}
                  regions={regions}
                  imageSize={imageSize}
                  activeId={activeRegionId}
                  onActiveChange={onActiveRegionChange || (() => undefined)}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-0 items-center justify-center px-4 text-center text-sm text-[var(--ink-muted)]">
                Preview not available for this file type — convert to see the result on the right.
              </div>
            )}
            {onEditText && canOfferEditor(file) ? (
              <p className="pointer-events-none absolute bottom-4 left-4 right-4 text-center text-[11px] text-[var(--ink-muted)]">
                <span className="pointer-events-auto rounded-full bg-[var(--bg)]/90 px-3 py-1.5">
                  {isPageStampFile(file)
                    ? PRODUCT.editOnPage
                    : isTextEditorFile(file)
                      ? PRODUCT.editDocument
                      : isWordDocxFile(file)
                        ? PRODUCT.editWord
                        : PRODUCT.editAsMarkdown}
                  ?{" "}
                  <button
                    type="button"
                    onClick={onEditText}
                    className="font-medium text-[var(--accent-strong)] underline-offset-2 hover:underline"
                  >
                    Open {PRODUCT.editor}
                  </button>
                </span>
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
