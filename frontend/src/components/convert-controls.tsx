"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Bot, Languages, Settings2, Sparkles, Square } from "lucide-react";
import {
  DEFAULT_EXTRACT_OPTIONS,
  type ExtractOptions,
  type HealthResponse,
  type TranslateLanguage,
} from "@/lib/api";
import type { MeResponse } from "@/lib/auth";
import { aiQuotaLeft, convertGate, convertGateTitle } from "@/lib/plans";
import { PlanPolicyDialog } from "@/components/plan-policy-dialog";
import { cn } from "@/lib/utils";

const ExtractOptionsPanel = dynamic(
  () => import("@/components/extract-options-panel").then((mod) => mod.ExtractOptionsPanel),
);

type ConvertControlsProps = {
  fileName?: string | null;
  options: ExtractOptions;
  onChange: (next: ExtractOptions) => void;
  me: MeResponse | null;
  health: HealthResponse | null;
  loading: boolean;
  canExtract: boolean;
  fileReady?: boolean;
  quotaBlocked: boolean;
  onConvert: () => void;
  onStop: () => void;
  compact?: boolean;
};

export function ConvertControls({
  fileName,
  options,
  onChange,
  me,
  health,
  loading,
  canExtract,
  fileReady = false,
  quotaBlocked,
  onConvert,
  onStop,
  compact = false,
}: ConvertControlsProps) {
  const [open, setOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const wantsAi = Boolean(options.use_ai || options.target_lang);
  const gate = convertGate({
    signedIn: Boolean(me?.user),
    canExtract,
    quotaBlocked,
    remainingDay: me?.quota.remaining_day,
    remainingMonth: me?.quota.remaining_month,
    wantsAi,
    remainingAiDay: me?.quota.remaining_ai_day,
    remainingAiMonth: me?.quota.remaining_ai_month,
  });
  const aiLeft = aiQuotaLeft(me?.quota);
  const canAi = Boolean(me?.permissions["extract.ai"] && health?.llm_ready && aiLeft);
  const canTranslate = Boolean(me?.permissions["extract.translate"] && health?.translate_ready && aiLeft);
  const languages: TranslateLanguage[] = health?.translate_languages?.length
    ? health.translate_languages
    : [{ id: "original", label: "Original (no translation)" }];
  const optionCount = (
    Object.keys(DEFAULT_EXTRACT_OPTIONS) as Array<keyof ExtractOptions>
  ).filter((key) => options[key] !== DEFAULT_EXTRACT_OPTIONS[key]).length;

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("flex items-center gap-2", compact && "min-w-0")}>
      {compact && fileName ? (
        <p className="hidden min-w-0 truncate text-sm text-[var(--ink-muted)] sm:block">{fileName}</p>
      ) : null}
      <div className="relative">
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-medium transition",
            open || optionCount > 0
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
              : "border-[var(--line)] bg-[var(--bg-panel)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)]",
          )}
        >
          <Settings2 size={14} />
          Options
          {optionCount > 0 ? (
            <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] text-white dark:text-[#06281d]">
              {optionCount}
            </span>
          ) : null}
        </button>
        {open ? (
          <div className="absolute right-0 top-full z-30 mt-2 max-h-[min(70vh,34rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow)]">
            <label
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5",
                options.use_ai
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)]",
                (!canAi || loading) && "opacity-55",
              )}
              title={
                !me?.permissions["extract.ai"]
                  ? "Sign in to use AI reading"
                  : !aiLeft
                    ? "AI or translation allowance is used"
                    : health?.llm_ready
                      ? "Use a vision model to read this file"
                      : health?.llm_error || "AI reading is not configured"
              }
            >
              <Bot size={16} className="shrink-0 text-[var(--accent)]" />
              <span className="min-w-0 flex-1 text-sm font-medium">Read with AI</span>
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={options.use_ai}
                disabled={loading || !canAi}
                onChange={(event) => onChange({ ...options, use_ai: event.target.checked })}
              />
            </label>
            <label
              className={cn(
                "mt-2 flex items-center gap-3 rounded-xl border px-3 py-2.5",
                options.target_lang
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)]",
              )}
              title={
                !me?.permissions["extract.translate"]
                  ? "Sign in to translate"
                  : !aiLeft
                    ? "AI or translation allowance is used"
                    : health?.translate_ready
                      ? "Translate Markdown after conversion"
                      : health?.translate_error || "Translation is not configured"
              }
            >
              <Languages size={16} className="shrink-0 text-[var(--accent)]" />
              <select
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                value={options.target_lang || "original"}
                disabled={loading}
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
            </label>
            <p className="mt-3 mb-2 px-1 text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              Layout
            </p>
            <ExtractOptionsPanel
              options={options}
              disabled={loading}
              embedded
              hideKeys={["use_ai"]}
              aiHint="Uses AI to read images and scanned PDFs"
              lockedKeys={
                me?.permissions["extract.ai"] && aiLeft
                  ? undefined
                  : {
                      use_ai: !aiLeft
                        ? "AI or translation allowance is used"
                        : "Sign in to use AI reading",
                    }
              }
              onChange={onChange}
            />
            {me && !me.user ? (
              <p className="mt-3 px-1 text-xs text-[var(--ink-muted)]">
                <a href="/login" className="text-[var(--accent-strong)] underline-offset-2 hover:underline">
                  Sign in
                </a>{" "}
                to convert files and save history. Basic includes one conversion per day with AI and translation.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {loading ? (
        <button
          type="button"
          onClick={onStop}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--danger)] bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] px-4 py-2 text-sm font-medium text-[var(--danger)]"
        >
          <Square size={13} fill="currentColor" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          disabled={!fileReady}
          title={!fileReady ? "Choose a file to convert" : gate !== "ready" ? convertGateTitle(gate) : undefined}
          onClick={() => {
            if (gate !== "ready") {
              setPolicyOpen(true);
              return;
            }
            onConvert();
          }}
          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition enabled:hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-45 dark:text-[#06281d]"
        >
          <Sparkles size={15} />
          {options.use_ai ? "Convert with AI" : "Convert"}
        </button>
      )}
      {policyOpen ? (
        <PlanPolicyDialog gate={gate === "ready" ? "login" : gate} onClose={() => setPolicyOpen(false)} />
      ) : null}
    </div>
  );
}
