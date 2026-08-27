"use client";

import { useEffect, useState } from "react";
import { FilePenLine, FileOutput, Replace } from "lucide-react";
import { isEditorSourceFile } from "@/lib/editor-files";
import { PRODUCT } from "@/lib/product-copy";
import { cn, formatBytes } from "@/lib/utils";

type HomePathChooserProps = {
  file: File;
  previewUrl: string | null;
  disabled?: boolean;
  onEdit: () => void;
  onProduce: () => void;
  onReplace: () => void;
};

export function HomePathChooser({
  file,
  previewUrl,
  disabled,
  onEdit,
  onProduce,
  onReplace,
}: HomePathChooserProps) {
  const canEdit = isEditorSourceFile(file);
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isText = Boolean(
    /\.(txt|md|markdown)$/i.test(file.name) ||
      file.type === "text/plain" ||
      file.type === "text/markdown" ||
      file.type === "text/x-markdown",
  );
  const [textPreview, setTextPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!isText) {
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

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-[var(--line)] bg-[color-mix(in_oklab,var(--bg-panel)_92%,transparent)] lg:flex-row">
      <section className="home-rise home-rise-1 relative flex min-h-[40%] min-w-0 flex-1 flex-col border-b border-[var(--line)] lg:min-h-0 lg:border-b-0 lg:border-r">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--line)] px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--ink)]">{file.name}</p>
            <p className="text-[11px] text-[var(--ink-muted)]">{formatBytes(file.size)}</p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={onReplace}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 text-xs text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)] disabled:opacity-50"
          >
            <Replace size={13} aria-hidden />
            Replace
          </button>
        </header>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[color-mix(in_oklab,var(--bg)_80%,black_4%)] p-3">
          {isPdf ? (
            <iframe
              title="PDF preview"
              src={previewUrl ?? undefined}
              className="h-full min-h-[12rem] w-full rounded-xl border border-[var(--line)] bg-white lg:min-h-0"
            />
          ) : isText ? (
            <pre className="h-full min-h-[12rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-[var(--line)] bg-[var(--bg)] p-4 text-sm leading-6 text-[var(--ink)] lg:min-h-0">
              {textPreview ?? "Loading…"}
            </pre>
          ) : previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt={file.name}
              className="mx-auto h-full max-h-full w-auto max-w-full object-contain"
            />
          ) : (
            <div className="flex h-full min-h-[12rem] items-center justify-center px-4 text-center text-sm text-[var(--ink-muted)] lg:min-h-0">
              Preview not available for this file type.
            </div>
          )}
        </div>
      </section>

      <section className="home-rise home-rise-2 flex w-full shrink-0 flex-col justify-center px-5 py-8 sm:px-8 lg:w-[min(26rem,42%)] lg:px-8 lg:py-10">
        <p className="font-[family-name:var(--font-display)] text-2xl tracking-tight text-[var(--ink)] sm:text-3xl">
          {PRODUCT.whatNext}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">
          {canEdit ? PRODUCT.homeSupport : PRODUCT.editorPdfImagesOnly}
        </p>

        <div className="mt-7 flex flex-col gap-3">
          {canEdit ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onEdit}
              className={cn(
                "group flex w-full flex-col items-start gap-1 rounded-2xl border border-[var(--line)] bg-[var(--bg)] px-4 py-4 text-left transition",
                "hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                "disabled:opacity-50",
              )}
            >
              <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--ink)] group-hover:text-[var(--accent-strong)]">
                <FilePenLine size={16} aria-hidden />
                {PRODUCT.editOnPage}
              </span>
              <span className="pl-6 text-xs leading-relaxed text-[var(--ink-muted)]">
                {PRODUCT.editOnPageHint}
              </span>
            </button>
          ) : null}

          <button
            type="button"
            disabled={disabled}
            onClick={onProduce}
            className={cn(
              "group flex w-full flex-col items-start gap-1 rounded-2xl border px-4 py-4 text-left transition",
              canEdit
                ? "border-[var(--line)] bg-[var(--bg)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
                : "border-[var(--accent)] bg-[var(--accent)] text-white dark:text-[#06281d] hover:bg-[var(--accent-strong)]",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
              "disabled:opacity-50",
            )}
          >
            <span
              className={cn(
                "inline-flex items-center gap-2 text-sm font-medium",
                canEdit ? "text-[var(--ink)] group-hover:text-[var(--accent-strong)]" : "",
              )}
            >
              <FileOutput size={16} aria-hidden />
              {PRODUCT.makeFromFile}
            </span>
            <span
              className={cn(
                "pl-6 text-xs leading-relaxed",
                canEdit ? "text-[var(--ink-muted)]" : "text-white/85 dark:text-[#06281d]/85",
              )}
            >
              {PRODUCT.makeFromFileHint}
            </span>
          </button>
        </div>
      </section>
    </div>
  );
}
