"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { Bot, Languages, Play, Search, Settings2, Square, X } from "lucide-react";
import {
  DEFAULT_EXTRACT_OPTIONS,
  type ExtractOptions,
  type HealthResponse,
  type TranslateLanguage,
} from "@/lib/api";
import type { MeResponse } from "@/lib/auth";
import { aiQuotaLeft, convertGate, convertGateTitle } from "@/lib/plans";
import { PlanPolicyDialog } from "@/components/plan-policy-dialog";
import { PRODUCT, produceActionLabel } from "@/lib/product-copy";
import { TEMPLATE_CATEGORIES } from "@/design-pad/templates";
import { cn } from "@/lib/utils";

const ExtractOptionsPanel = dynamic(
  () => import("@/components/extract-options-panel").then((mod) => mod.ExtractOptionsPanel),
);

export type TargetTemplateOption = {
  id: string;
  name: string;
  description?: string;
  /** Starter taxonomy: family | business | general (from TEMPLATE_CATEGORIES). */
  category?: string;
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
  /** "standard" = Markdown; "builtin:<id>" = starter template; else saved template id. */
  outputLayout?: string;
  /** Built-in starter templates (predefined layouts with variables). */
  designTargets?: TargetTemplateOption[];
  /** User-saved templates that declare variables. */
  templates?: TargetTemplateOption[];
  templateNeedsAi?: boolean;
  returnFileType?: "markdown" | "docx" | "pdf";
  onOutputLayoutChange?: (value: string) => void;
  onReturnFileTypeChange?: (value: "markdown" | "docx" | "pdf") => void;
};

export function ConvertControls({
  fileName: _fileName,
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
  compact: _compact = false,
  outputLayout = "standard",
  designTargets = [],
  templates = [],
  templateNeedsAi = false,
  returnFileType = "markdown",
  onOutputLayoutChange,
  onReturnFileTypeChange,
}: ConvertControlsProps) {
  const [open, setOpen] = useState(false);
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
      PRODUCT.design
    : null;
  const actionLabel = produceActionLabel({
    intentName: selectedTemplateName,
    useAi: options.use_ai,
  });
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
    // Defer so the opening click cannot race the dismiss listener (Playwright / Strict Mode).
    const timer = window.setTimeout(() => {
      document.addEventListener("mousedown", onPointer);
    }, 0);
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="flex shrink-0 items-center gap-1"
      role="toolbar"
      aria-label="Convert actions"
    >
      <div className="relative shrink-0">
        <button
          type="button"
          aria-label="Options"
          aria-expanded={open}
          aria-haspopup="dialog"
          title={optionCount > 0 ? `Options · ${optionCount} changed` : "Conversion options"}
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "relative inline-flex h-8 w-8 items-center justify-center rounded-full border transition",
            open || optionCount > 0
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
              : "border-[var(--line)] bg-[var(--bg-panel)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)]",
          )}
        >
          <Settings2 size={14} aria-hidden />
          {optionCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[9px] leading-none text-white dark:text-[#06281d]">
              {optionCount}
            </span>
          ) : null}
        </button>
        {open ? (
          <div
            role="dialog"
            aria-label="Conversion options"
            className={cn(
              "z-50 overflow-y-auto overscroll-contain rounded-2xl border border-[var(--line)] bg-[var(--bg-elevated)] p-3 shadow-[var(--shadow)]",
              "fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] max-h-[min(70dvh,calc(100dvh-1.5rem))] w-auto",
              "sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[min(70vh,34rem)] sm:w-[min(22rem,calc(100vw-2rem))]",
            )}
          >            <label
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
                to convert on{" "}
                <span className="font-medium text-[var(--accent-strong)]">Free Basic</span>{" "}
                (5 conversions / day, no credit card) and save history.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {loading ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Stop conversion"
          title="Stop conversion"
          className="ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--danger)] bg-[color-mix(in_oklab,var(--danger)_10%,var(--bg-panel))] text-[var(--danger)] transition hover:bg-[color-mix(in_oklab,var(--danger)_16%,var(--bg-panel))]"
        >
          <Square size={11} fill="currentColor" strokeWidth={0} aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          disabled={!fileReady}
          aria-label={actionLabel}
          title={
            !fileReady
              ? selectedTemplateName
                ? `Drop a file to fill ${selectedTemplateName}`
                : "Choose a file to convert"
              : gate !== "ready"
                ? convertGateTitle(gate)
                : actionLabel
          }
          onClick={() => {
            if (gate !== "ready") {
              setPolicyOpen(true);
              return;
            }
            onConvert();
          }}
          className={cn(
            "ml-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full border transition",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
            "disabled:cursor-not-allowed disabled:opacity-40",
            fileReady
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)] enabled:hover:border-[var(--accent-strong)] enabled:hover:bg-[color-mix(in_oklab,var(--accent-soft)_70%,var(--accent)_18%)]"
              : "border-[var(--line)] bg-[var(--bg-panel)] text-[var(--ink-muted)]",
          )}
        >
          <Play size={15} strokeWidth={2.25} aria-hidden />
        </button>
      )}
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

export function TargetFormatDialog({
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

  const dialog = (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-[color-mix(in_oklab,var(--ink)_28%,transparent)] p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        // Only dismiss when the backdrop itself is pressed — avoids closing on the
        // same gesture that opened the dialog (Playwright / rapid clicks).
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-format-title"
        className="panel flex max-h-[min(92dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4 sm:px-6 sm:pt-5">
          <div className="min-w-0 flex-1">
            <p
              id="target-format-title"
              className="font-[family-name:var(--font-display)] text-xl tracking-tight sm:text-2xl"
            >
              {PRODUCT.produceAs}
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">
              {PRODUCT.homeLine} Markdown is the default. Choose a starter design (family schedules,
              invoices, agendas, plans) or one of your saved designs to fill from the converted
              document.
            </p>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        <fieldset className="space-y-2">
          <legend className="sr-only">{PRODUCT.produceAs}</legend>
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
                  <span className="block text-sm font-medium text-[var(--ink)]">{PRODUCT.starterDesign}</span>
                  <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                    Family, business, and general fillable layouts
                  </span>
                </span>
              </label>
              <StarterDesignPicker
                options={designTargets}
                selectedId={selectedDesignId}
                onSelect={(id) => onOutputLayoutChange?.(id)}
                onActivate={() => {
                  if (!designSelected && outputLayout === "standard" && defaultDesignId) {
                    onOutputLayoutChange?.(defaultDesignId);
                  }
                }}
              />
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
                <span className="block text-sm font-medium text-[var(--ink)]">{PRODUCT.myDesign}</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">
                  {templates.length > 0
                    ? "One of your saved fillable designs"
                    : `Save a design in ${PRODUCT.designs} to enable this`}
                </span>
              </span>
            </label>
            {templates.length > 0 ? (
              <select
                aria-label={PRODUCT.myDesign}
                value={selectedMineId}
                onChange={(event) => onOutputLayoutChange?.(event.target.value)}
                onFocus={() => {
                  if (!mineSelected && outputLayout === "standard" && defaultMineId) {
                    onOutputLayoutChange?.(defaultMineId);
                  }
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
                  Open {PRODUCT.designs}
                </a>{" "}
                to create and save one.
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
                value={returnFileType === "markdown" ? "pdf" : returnFileType}
                onChange={(event) =>
                  onReturnFileTypeChange?.(event.target.value as "markdown" | "docx" | "pdf")
                }
                className="w-full rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] px-3 py-2 text-sm text-[var(--ink)] outline-none"
              >
                <option value="docx">DOCX</option>
                <option value="pdf">PDF</option>
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
        </div>

        <div className="flex shrink-0 justify-end border-t border-[var(--line)] px-4 py-3 sm:px-6">
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

  if (typeof document === "undefined") return dialog;
  return createPortal(dialog, document.body);
}

function StarterDesignPicker({
  options,
  selectedId,
  onSelect,
  onActivate,
}: {
  options: TargetTemplateOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onActivate: () => void;
}) {
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options.filter((option) => {
      if (categoryFilter !== "all" && option.category !== categoryFilter) return false;
      if (!q) return true;
      const hay = `${option.name} ${option.description || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query, categoryFilter]);

  return (
    <div className="mt-3 space-y-2">
      <label className="relative block">
        <span className="sr-only">Search designs</span>
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]"
        />
        <input
          type="search"
          value={query}
          placeholder="Search designs…"
          onFocus={onActivate}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] py-2 pl-8 pr-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus:border-[var(--accent)]"
        />
      </label>

      <div className="flex flex-wrap gap-1.5" role="toolbar" aria-label="Design category">
        <button
          type="button"
          onClick={() => {
            onActivate();
            setCategoryFilter("all");
          }}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
            categoryFilter === "all"
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
              : "border-[var(--line)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)]",
          )}
        >
          All
        </button>
        {TEMPLATE_CATEGORIES.map((cat) => (
          <button
            type="button"
            key={cat.id}
            onClick={() => {
              onActivate();
              setCategoryFilter(cat.id);
            }}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium transition",
              categoryFilter === cat.id
                ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                : "border-[var(--line)] text-[var(--ink-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-strong)]",
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div
        role="listbox"
        aria-label={PRODUCT.starterDesign}
        className="max-h-40 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] sm:max-h-52"
      >
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-[var(--ink-muted)]">No designs match.</p>
        ) : (
          filtered.map((option) => {
            const selected = option.id === selectedId;
            return (
              <button
                type="button"
                key={option.id}
                role="option"
                aria-selected={selected}
                onClick={() => onSelect(option.id)}
                className={cn(
                  "flex w-full flex-col gap-0.5 border-b border-[var(--line)] px-3 py-2.5 text-left transition last:border-b-0",
                  selected
                    ? "bg-[var(--accent-soft)]"
                    : "hover:bg-[color-mix(in_oklab,var(--accent-soft)_55%,transparent)]",
                )}
              >
                <span className="text-sm font-medium text-[var(--ink)]">{option.name}</span>
                {option.description ? (
                  <span className="line-clamp-2 text-xs leading-relaxed text-[var(--ink-muted)]">
                    {option.description}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
