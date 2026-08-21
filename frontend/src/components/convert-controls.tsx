"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Bot, FileOutput, Languages, Settings2, Sparkles, Square, X } from "lucide-react";
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

export type TargetTemplateOption = {
  id: string;
  name: string;
  description?: string;
};

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
  onConvertWithDefaults?: () => void;
  onStop: () => void;
  compact?: boolean;
  /** "standard" = Markdown; "builtin:<id>" = Design target; else saved template id. */
  outputLayout?: string;
  /** Built-in Design targets (predefined starters with variables). */
  designTargets?: TargetTemplateOption[];
  /** User-saved templates that declare variables. */
  templates?: TargetTemplateOption[];
  templateNeedsAi?: boolean;
  returnFileType?: "markdown" | "docx" | "pdf";
  onOutputLayoutChange?: (value: string) => void;
  onReturnFileTypeChange?: (value: "markdown" | "docx" | "pdf") => void;
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
  onConvertWithDefaults,
  onStop,
  compact = false,
  outputLayout = "standard",
  designTargets = [],
  templates = [],
  templateNeedsAi = false,
  returnFileType = "markdown",
  onOutputLayoutChange,
  onReturnFileTypeChange,
}: ConvertControlsProps) {
  const [open, setOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const wantsAi = Boolean(options.use_ai || options.target_lang || templateNeedsAi);
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
  const layoutCustom = outputLayout !== "standard";
  const selectedTemplateName = layoutCustom
    ? designTargets.find((template) => template.id === outputLayout)?.name ||
      templates.find((template) => template.id === outputLayout)?.name ||
      "Template"
    : null;
  const targetLabel = selectedTemplateName || "Markdown";
  const showDefaultsEscape =
    templateNeedsAi && (gate === "quota_ai_day" || gate === "quota_ai_month") && Boolean(onConvertWithDefaults);

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

  useEffect(() => {
    if (!targetOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setTargetOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [targetOpen]);

  return (
    <div ref={rootRef} className={cn("flex shrink-0 items-center gap-1.5", compact && "min-w-0")}>
      {compact && fileName ? (
        <p className="hidden min-w-0 truncate text-sm text-[var(--ink-muted)] sm:block">{fileName}</p>
      ) : null}
      <button
        type="button"
        aria-label="Target format"
        aria-haspopup="dialog"
        aria-expanded={targetOpen}
        title="Choose Markdown or a fillable template"
        disabled={loading}
        onClick={() => setTargetOpen(true)}
        className={cn(
          "inline-flex h-8 max-w-[10rem] items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
          layoutCustom
            ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
            : "border-[var(--line)] bg-[var(--bg-panel)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)]",
        )}
      >
        <FileOutput size={14} className="shrink-0" />
        <span className="truncate">{targetLabel}</span>
      </button>
      <div className="relative">
        <button
          type="button"
          aria-label="Options"
          aria-expanded={open}
          aria-haspopup="dialog"
          title="Conversion options"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition",
            open || optionCount > 0
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
              : "border-[var(--line)] bg-[var(--bg-panel)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)]",
            compact && "px-2",
          )}
        >
          <Settings2 size={14} />
          {!compact ? <span>Options</span> : null}
          {optionCount > 0 ? (
            <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] leading-[16px] text-white dark:text-[#06281d]">
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
                to convert files and save history. Basic includes five conversions per day and a small AI allowance.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {loading ? (
        <button
          type="button"
          onClick={onStop}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--danger)] bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] px-3 text-sm font-medium text-[var(--danger)]"
        >
          <Square size={13} fill="currentColor" />
          Stop
        </button>
      ) : (
        <button
          type="button"
          disabled={!fileReady}
          title={
            !fileReady
              ? "Choose a file to convert"
              : gate !== "ready"
                ? convertGateTitle(gate)
                : options.use_ai
                  ? "Convert with AI"
                  : "Convert"
          }
          onClick={() => {
            if (gate !== "ready") {
              setPolicyOpen(true);
              return;
            }
            onConvert();
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-sm font-medium text-white transition enabled:hover:bg-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-45 dark:text-[#06281d]"
        >
          <Sparkles size={14} />
          {options.use_ai ? "AI Convert" : "Convert"}
        </button>
      )}
      {targetOpen ? (
        <TargetFormatDialog
          outputLayout={outputLayout}
          designTargets={designTargets}
          templates={templates}
          returnFileType={returnFileType}
          templateNeedsAi={templateNeedsAi}
          wantsReadAi={Boolean(options.use_ai || options.target_lang)}
          onOutputLayoutChange={onOutputLayoutChange}
          onReturnFileTypeChange={onReturnFileTypeChange}
          onClose={() => setTargetOpen(false)}
        />
      ) : null}
      {policyOpen ? (
        <PlanPolicyDialog
          gate={gate === "ready" ? "login" : gate}
          onClose={() => setPolicyOpen(false)}
          secondaryLabel={showDefaultsEscape ? "Preview with defaults" : undefined}
          onSecondary={showDefaultsEscape ? onConvertWithDefaults : undefined}
        />
      ) : null}
    </div>
  );
}

function TargetFormatDialog({
  outputLayout,
  designTargets,
  templates,
  returnFileType,
  templateNeedsAi,
  wantsReadAi,
  onOutputLayoutChange,
  onReturnFileTypeChange,
  onClose,
}: {
  outputLayout: string;
  designTargets: TargetTemplateOption[];
  templates: TargetTemplateOption[];
  returnFileType: "markdown" | "docx" | "pdf";
  templateNeedsAi: boolean;
  wantsReadAi: boolean;
  onOutputLayoutChange?: (value: string) => void;
  onReturnFileTypeChange?: (value: "markdown" | "docx" | "pdf") => void;
  onClose: () => void;
}) {
  const layoutCustom = outputLayout !== "standard";
  const designSelected = designTargets.some((option) => option.id === outputLayout);
  const mineSelected = templates.some((option) => option.id === outputLayout);
  const defaultDesignId = designTargets[0]?.id || "";
  const defaultMineId = templates[0]?.id || "";
  const selectedDesignId = designSelected ? outputLayout : defaultDesignId;
  const selectedMineId = mineSelected ? outputLayout : defaultMineId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklab,var(--ink)_28%,transparent)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-format-title"
        className="panel w-full max-w-md rounded-3xl px-6 py-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p
              id="target-format-title"
              className="font-[family-name:var(--font-display)] text-2xl tracking-tight"
            >
              Target format
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
              Markdown is the default. Choose a designed template or one of your saved templates to
              AI-fill from the converted document.
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
          >
            <X size={16} />
          </button>
        </div>

        <fieldset className="mt-5 space-y-2">
          <legend className="sr-only">Target format</legend>

          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-2xl border px-3 py-3 transition",
              outputLayout === "standard"
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line)] hover:border-[var(--accent)]",
            )}
          >
            <input
              type="radio"
              name="target-format"
              className="mt-1 accent-[var(--accent)]"
              checked={outputLayout === "standard"}
              onChange={() => onOutputLayoutChange?.("standard")}
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-[var(--ink)]">Markdown</span>
              <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                Converted source document
              </span>
            </span>
          </label>

          {designTargets.length > 0 ? (
            <div
              className={cn(
                "rounded-2xl border px-3 py-3 transition",
                designSelected
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)]",
              )}
            >
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="target-format"
                  className="mt-1 accent-[var(--accent)]"
                  checked={designSelected}
                  onChange={() => {
                    if (defaultDesignId) onOutputLayoutChange?.(defaultDesignId);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-[var(--ink)]">Designed template</span>
                  <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                    Predefined layout from Design targets
                  </span>
                </span>
              </label>
              <select
                aria-label="Designed template"
                value={selectedDesignId}
                onChange={(event) => onOutputLayoutChange?.(event.target.value)}
                onFocus={() => {
                  if (!designSelected && defaultDesignId) onOutputLayoutChange?.(defaultDesignId);
                }}
                className="mt-3 w-full rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2 text-sm text-[var(--ink)] outline-none"
              >
                {designTargets.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div
            className={cn(
              "rounded-2xl border px-3 py-3 transition",
              mineSelected
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line)]",
            )}
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="target-format"
                className="mt-1 accent-[var(--accent)]"
                checked={mineSelected}
                disabled={templates.length === 0}
                onChange={() => {
                  if (defaultMineId) onOutputLayoutChange?.(defaultMineId);
                }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-[var(--ink)]">My template</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                  {templates.length > 0
                    ? "One of your saved fillable templates"
                    : "Save a template in Templates to enable this"}
                </span>
              </span>
            </label>
            {templates.length > 0 ? (
              <select
                aria-label="My template"
                value={selectedMineId}
                onChange={(event) => onOutputLayoutChange?.(event.target.value)}
                onFocus={() => {
                  if (!mineSelected && defaultMineId) onOutputLayoutChange?.(defaultMineId);
                }}
                className="mt-3 w-full rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2 text-sm text-[var(--ink)] outline-none"
              >
                {templates.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="mt-3 text-xs text-[var(--ink-muted)]">
                <a
                  href="/templates"
                  className="text-[var(--accent-strong)] underline-offset-2 hover:underline"
                >
                  Open Templates
                </a>{" "}
                to design and save one.
              </p>
            )}
          </div>
        </fieldset>

        {layoutCustom ? (
          <div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4">
            <label className="flex flex-col gap-1.5 text-[11px] text-[var(--ink-muted)]">
              <span className="uppercase tracking-[0.12em]">Download as</span>
              <select
                aria-label="Return file type"
                value={returnFileType}
                onChange={(event) =>
                  onReturnFileTypeChange?.(event.target.value as "markdown" | "docx" | "pdf")
                }
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2 text-sm text-[var(--ink)] outline-none"
              >
                <option value="markdown">Markdown</option>
                <option value="docx">DOCX</option>
                <option value="pdf">PDF (print)</option>
              </select>
            </label>
            {templateNeedsAi ? (
              <p className="text-[11px] leading-relaxed text-[var(--ink-muted)]">
                Filling this template uses 1 AI credit from your plan allowance
                {wantsReadAi ? " (convert + fill may use 2)" : ""}.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white dark:text-[#06281d]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
