"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { Upload } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { BUSINESS_NAME } from "@/lib/legal";
import { PRODUCT } from "@/lib/product-copy";
import { cn } from "@/lib/utils";

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

type HomeLandingProps = {
  disabled?: boolean;
  intentName?: string | null;
  onFileSelect: (file: File) => void;
  onOpenHistory?: () => void;
};

export function HomeLanding({
  disabled,
  intentName = null,
  onFileSelect,
  onOpenHistory,
}: HomeLandingProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const take = useCallback(
    (list: FileList | null) => {
      const next = list?.[0];
      if (next && !disabled) onFileSelect(next);
    },
    [disabled, onFileSelect],
  );

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => {
      event.preventDefault();
      if (!disabled) setDragging(true);
    },
    onDragOver: (event: DragEvent) => {
      event.preventDefault();
      if (!disabled) setDragging(true);
    },
    onDragLeave: (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      take(event.dataTransfer.files);
    },
  };

  return (
    <div
      className={cn(
        "home-landing relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-[var(--line)]",
        "bg-[color-mix(in_oklab,var(--bg-panel)_92%,transparent)]",
        dragging && "border-[var(--accent)] bg-[var(--accent-soft)]",
      )}
      {...dropHandlers}
    >
      <div className="home-landing-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10 text-center sm:px-10">
        <div className="home-rise home-rise-1 mb-8 inline-flex items-center gap-2.5 text-[var(--ink)]" aria-hidden>
          <BrandMark className="h-9 w-9 shrink-0 text-[var(--accent)] sm:h-10 sm:w-10" />
          <span className="font-[family-name:var(--font-display)] text-3xl tracking-tight sm:text-4xl">
            {BUSINESS_NAME}
          </span>
        </div>

        <p className="home-rise home-rise-2 max-w-xl font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)] sm:text-3xl">
          {intentName ? `Drop a file to fill ${intentName}` : PRODUCT.homeLine}
        </p>
        <p className="home-rise home-rise-3 mt-3 max-w-md text-sm leading-relaxed text-[var(--ink-muted)]">
          {intentName
            ? "We’ll open Convert with this Design ready. You can still edit text on a PDF or image first if you prefer."
            : PRODUCT.homeSupport}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          disabled={disabled}
          onChange={(event) => {
            take(event.target.files);
            event.target.value = "";
          }}
        />

        <button
          type="button"
          aria-label="Upload document"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "home-rise home-rise-4 home-drop-cta mt-10 inline-flex min-h-[3.25rem] w-full max-w-md items-center justify-center gap-2.5 rounded-2xl border px-5 py-3.5 text-base font-medium transition",
            "border-[var(--accent)] bg-[var(--accent)] text-white dark:text-[#06281d]",
            "hover:bg-[var(--accent-strong)] disabled:opacity-50",
          )}
        >
          <Upload size={18} aria-hidden />
          <span className="min-w-0 truncate">
            {intentName ? `Choose file for ${intentName}` : PRODUCT.dropOrChoose}
          </span>
        </button>

        <p className="home-rise home-rise-5 mt-4 max-w-md text-[11px] leading-relaxed text-[var(--ink-muted)]">
          Word, Excel, PowerPoint, PDF, Markdown, TXT, CSV, images · up to 50MB
        </p>

        <div className="home-rise home-rise-5 mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
          <a
            href="/edit"
            className="text-[var(--ink-muted)] underline-offset-2 transition hover:text-[var(--accent-strong)] hover:underline"
          >
            Open {PRODUCT.editor}
          </a>
          <span className="text-[var(--line)]" aria-hidden>
            ·
          </span>
          <a
            href="/templates"
            className="text-[var(--ink-muted)] underline-offset-2 transition hover:text-[var(--accent-strong)] hover:underline"
          >
            Browse {PRODUCT.designs}
          </a>
          {onOpenHistory ? (
            <>
              <span className="text-[var(--line)]" aria-hidden>
                ·
              </span>
              <button
                type="button"
                onClick={onOpenHistory}
                className="text-[var(--ink-muted)] underline-offset-2 transition hover:text-[var(--accent-strong)] hover:underline"
              >
                History
              </button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
