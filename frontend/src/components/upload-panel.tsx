"use client";

import { FileImage, FileOutput, FileText, PanelLeftClose, Replace, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { ImageSize, RegionBox } from "@/lib/api";
import { PRODUCT } from "@/lib/product-copy";
import { cn, formatBytes } from "@/lib/utils";
import { AnnotatedImage } from "@/components/region-overlay";

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
  actions?: ReactNode;
  leadingToggle?: ReactNode;
  /** When set, empty dropzone invites filling this Design (Source meets Intent). */
  intentName?: string | null;
  /** Opens Produce as — second half of the empty-state sentence. */
  onChooseIntent?: () => void;
};

const ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "application/pdf",
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
  ".csv",
  ".txt",
  ".md",
  ".markdown",
].join(",");

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
  actions,
  leadingToggle,
  intentName = null,
  onChooseIntent,
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
        <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-t-2xl border-b border-[var(--line)] px-3 py-2">
          {leadingToggle}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {file ? (
              isPdf || isText ? (
                <FileText size={15} className="shrink-0 text-[var(--accent)]" />
              ) : (
                <FileImage size={15} className="shrink-0 text-[var(--accent)]" />
              )
            ) : (
              <Upload size={15} className="shrink-0 text-[var(--accent)]" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file ? file.name : "Source"}</p>
              <p className="truncate text-[11px] text-[var(--ink-muted)]">
                {dragging && file
                  ? "Drop to replace"
                  : file
                    ? `${formatBytes(file.size)}${regions.length > 0 ? ` · ${regions.length} regions` : ""}`
                    : intentName
                      ? `Drop a file to fill ${intentName}`
                      : "Drop a file. Choose what to produce."}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {file ? (
              <>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={openPicker}
                  aria-label="Replace file"
                  title="Replace file"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] disabled:opacity-50"
                >
                  <Replace size={14} />
                </button>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label="Clear file"
                  title="Clear file"
                  onClick={() => onFileSelect(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--danger)] disabled:opacity-50"
                >
                  <X size={14} />
                </button>
              </>
            ) : null}
            {onCollapse ? (
              <button
                type="button"
                aria-label="Hide source"
                title="Hide source"
                onClick={onCollapse}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
              >
                <PanelLeftClose size={14} />
              </button>
            ) : null}
            {actions ? <div className="ml-1 flex shrink-0 items-center">{actions}</div> : null}
          </div>
        </div>

        {!file ? (
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 py-10 text-center transition",
              dragging ? "bg-[var(--accent-soft)]" : "",
              disabled && "pointer-events-none opacity-60",
            )}
            {...dropHandlers}
          >
            <div>
              <p className="font-[family-name:var(--font-display)] text-xl tracking-tight text-[var(--ink)]">
                {PRODUCT.homeLine}
              </p>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                {intentName
                  ? `Intent: ${intentName}. Drop the source file to continue.`
                  : "Source is your file. Intent is Markdown or a Design."}
              </p>
            </div>

            <div className="flex w-full max-w-sm flex-col gap-2 sm:flex-row sm:justify-center">
              <button
                type="button"
                aria-label="Upload document"
                onClick={openPicker}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition",
                  "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)] hover:bg-[color-mix(in_oklab,var(--accent-soft)_80%,var(--accent)_12%)]",
                )}
              >
                <Upload size={16} />
                {intentName ? `Drop file for ${intentName}` : "Drop or choose a file"}
              </button>
              {onChooseIntent ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChooseIntent();
                  }}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-3 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
                >
                  <FileOutput size={16} />
                  {intentName ? `Change Intent` : PRODUCT.produceAs}
                </button>
              ) : null}
            </div>

            <p className="max-w-sm text-[11px] leading-relaxed text-[var(--ink-muted)]">
              Word, Excel, PowerPoint, PDF, Markdown, TXT, CSV, images · up to 50MB
            </p>
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
              <div className="flex h-full min-h-0 items-center justify-center text-sm text-[var(--ink-muted)]">
                Preview not available for this file type — convert to see Markdown on the right.
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
