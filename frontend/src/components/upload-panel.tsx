"use client";

import { FileImage, FileText, PanelLeftClose, Replace, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import type { ImageSize, RegionBox } from "@/lib/api";
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
            <p className="text-[11px] text-[var(--ink-muted)]">
              {file
                ? `${formatBytes(file.size)}${regions.length > 0 ? ` · ${regions.length} regions` : ""}`
                : "Drop a file or browse"}
            </p>
          </div>
          {dragging && file ? (
            <span className="text-xs text-[var(--accent-strong)]">Drop to replace</span>
          ) : null}
          {file ? (
            <>
              <button
                type="button"
                disabled={disabled}
                onClick={openPicker}
                className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] disabled:opacity-50"
              >
                <Replace size={13} />
                Replace
              </button>
              <button
                type="button"
                disabled={disabled}
                aria-label="Clear file"
                onClick={() => onFileSelect(null)}
                className="rounded-full p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--danger)] disabled:opacity-50"
              >
                <X size={14} />
              </button>
            </>
          ) : null}
          {onCollapse ? (
            <button
              type="button"
              aria-label="Hide source"
              onClick={onCollapse}
              className="rounded-full p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
            >
              <PanelLeftClose size={14} />
            </button>
          ) : null}
          {actions ? <div className="ml-auto flex shrink-0 items-center">{actions}</div> : null}
        </div>

        {!file ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload document"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") openPicker();
            }}
            onClick={openPicker}
            {...dropHandlers}
            className={cn(
              "flex min-h-0 flex-1 cursor-pointer flex-col items-center justify-center gap-3 px-6 py-10 text-center transition",
              dragging ? "bg-[var(--accent-soft)]" : "hover:bg-[color-mix(in_oklab,var(--accent-soft)_35%,transparent)]",
              disabled && "pointer-events-none opacity-60",
            )}
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Upload size={22} />
            </span>
            <div>
              <p className="text-sm font-medium">Drop a file here</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
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
