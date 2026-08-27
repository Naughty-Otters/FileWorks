"use client";

import { Bot, Languages } from "lucide-react";
import {
  type ExtractOptions,
  type HealthResponse,
  type TranslateLanguage,
} from "@/lib/api";
import type { MeResponse } from "@/lib/auth";
import { aiQuotaLeft } from "@/lib/plans";
import { cn } from "@/lib/utils";

type ProduceRevenueOptionsProps = {
  options: ExtractOptions;
  onChange: (next: ExtractOptions) => void;
  me: MeResponse | null;
  health: HealthResponse | null;
  loading?: boolean;
  className?: string;
  /** Larger touch targets for the empty Target panel. */
  prominent?: boolean;
};

/**
 * AI reading + translation — the paid levers next to Choose Design.
 * Same gates as the Source “Options” popover.
 */
export function ProduceRevenueOptions({
  options,
  onChange,
  me,
  health,
  loading = false,
  className,
  prominent = false,
}: ProduceRevenueOptionsProps) {
  const aiLeft = aiQuotaLeft(me?.quota);
  const canAi = Boolean(me?.permissions["extract.ai"] && health?.llm_ready && aiLeft);
  const canTranslate = Boolean(
    me?.permissions["extract.translate"] && health?.translate_ready && aiLeft,
  );
  const languages: TranslateLanguage[] = health?.translate_languages?.length
    ? health.translate_languages
    : [{ id: "original", label: "Original (no translation)" }];

  const aiTitle = !me?.permissions["extract.ai"]
    ? "Sign in to use AI reading"
    : !aiLeft
      ? "AI or translation allowance is used"
      : health?.llm_ready
        ? "Use a vision model to read this file"
        : health?.llm_error || "AI reading is not configured";

  const translateTitle = !me?.permissions["extract.translate"]
    ? "Sign in to translate"
    : !aiLeft
      ? "AI or translation allowance is used"
      : health?.translate_ready
        ? "Translate Markdown after conversion"
        : health?.translate_error || "Translation is not configured";

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <label
        className={cn(
          "flex items-center gap-3 rounded-xl border text-left transition",
          prominent ? "px-3.5 py-3" : "px-3 py-2.5",
          options.use_ai
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-[var(--line)] bg-[var(--bg)]",
          (!canAi || loading) && "opacity-55",
        )}
        title={aiTitle}
      >
        <Bot size={16} className="shrink-0 text-[var(--accent)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-[var(--ink)]">Read with AI</span>
          {prominent ? (
            <span className="mt-0.5 block text-[11px] leading-snug text-[var(--ink-muted)]">
              Better on scans and hard pages — uses AI pages
            </span>
          ) : null}
        </span>
        <input
          type="checkbox"
          className="accent-[var(--accent)]"
          checked={options.use_ai}
          disabled={loading || !canAi}
          onChange={(event) => onChange({ ...options, use_ai: event.target.checked })}
          aria-label="Read with AI"
        />
      </label>

      <label
        className={cn(
          "flex items-center gap-3 rounded-xl border text-left transition",
          prominent ? "px-3.5 py-3" : "px-3 py-2.5",
          options.target_lang
            ? "border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-[var(--line)] bg-[var(--bg)]",
          loading && "opacity-55",
        )}
        title={translateTitle}
      >
        <Languages size={16} className="shrink-0 text-[var(--accent)]" aria-hidden />
        <span className="min-w-0 flex-1">
          {prominent ? (
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ink-muted)]">
              Translate
            </span>
          ) : null}
          <select
            className="w-full min-w-0 bg-transparent text-sm text-[var(--ink)] outline-none"
            value={options.target_lang || "original"}
            disabled={loading}
            aria-label="Translate to"
            onChange={(event) =>
              onChange({
                ...options,
                target_lang: event.target.value === "original" ? "" : event.target.value,
              })
            }
          >
            {languages.map((item) => (
              <option
                key={item.id}
                value={item.id}
                disabled={item.id !== "original" && !canTranslate}
              >
                {item.label}
              </option>
            ))}
          </select>
        </span>
      </label>
    </div>
  );
}
