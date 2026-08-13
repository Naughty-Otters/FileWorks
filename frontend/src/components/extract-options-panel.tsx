"use client";

import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import type { ExtractOptions } from "@/lib/api";
import { cn } from "@/lib/utils";

type BooleanOptionKey = Exclude<keyof ExtractOptions, "target_lang">;

type ExtractOptionsPanelProps = {
  options: ExtractOptions;
  disabled?: boolean;
  aiHint?: string;
  lockedKeys?: Partial<Record<BooleanOptionKey, string>>;
  embedded?: boolean;
  hideKeys?: BooleanOptionKey[];
  onChange: (next: ExtractOptions) => void;
};

const OPTION_META: Array<{
  key: BooleanOptionKey;
  label: string;
  hint: string;
}> = [
  {
    key: "use_ai",
    label: "Read with AI",
    hint: "Uses AI to read images and scanned PDFs",
  },
  {
    key: "use_doc_preprocessor",
    label: "Doc preprocessor",
    hint: "Orientation / unwarping cleanup",
  },
  {
    key: "use_table_recognition",
    label: "Table recognition",
    hint: "Recover grid / table layout",
  },
  {
    key: "use_formula_recognition",
    label: "Formula recognition",
    hint: "Math formulas as LaTeX",
  },
  {
    key: "use_seal_recognition",
    label: "Seal recognition",
    hint: "Stamps and seals",
  },
  {
    key: "use_chart_recognition",
    label: "Chart recognition",
    hint: "Charts to structured data",
  },
  {
    key: "use_region_detection",
    label: "Region detection",
    hint: "Layout region analysis",
  },
  {
    key: "format_block_content",
    label: "Format block content",
    hint: "Markdown / HTML block formatting",
  },
];

export function ExtractOptionsPanel({
  options,
  disabled,
  aiHint,
  lockedKeys,
  embedded = false,
  hideKeys = [],
  onChange,
}: ExtractOptionsPanelProps) {
  const [open, setOpen] = useState(false);
  const visible = OPTION_META.filter((item) => !hideKeys.includes(item.key));
  const enabledCount = visible.filter((item) => options[item.key]).length;

  const grid = (
    <div className={cn("grid gap-2", embedded ? "grid-cols-1" : "sm:grid-cols-2")}>
      {visible.map((item) => {
        const checked = options[item.key];
        const lockReason = lockedKeys?.[item.key];
        const itemDisabled = Boolean(disabled || lockReason);
        return (
          <label
            key={item.key}
            title={lockReason}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2 transition",
              checked
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line)] hover:border-[color-mix(in_oklab,var(--accent)_40%,var(--line))]",
              itemDisabled && "pointer-events-none opacity-55",
            )}
          >
            <input
              type="checkbox"
              className="mt-1 accent-[var(--accent)]"
              checked={checked}
              disabled={itemDisabled}
              onChange={(e) =>
                onChange({
                  ...options,
                  [item.key]: e.target.checked,
                })
              }
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{item.label}</span>
              <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">
                {item.key === "use_ai" && aiHint ? aiHint : item.hint}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );

  if (embedded) return grid;

  return (
    <div className="panel overflow-hidden rounded-2xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-[color-mix(in_oklab,var(--accent-soft)_40%,transparent)]"
      >
        <span className="flex items-center gap-2 text-sm font-medium">
          <SlidersHorizontal size={15} className="text-[var(--accent)]" />
          Parse options
          <span className="rounded-full border border-[var(--line)] px-2 py-0.5 text-[11px] font-normal text-[var(--ink-muted)]">
            {enabledCount}/{visible.length} on
          </span>
        </span>
        <ChevronDown
          size={16}
          className={cn("text-[var(--ink-muted)] transition", open && "rotate-180")}
        />
      </button>
      {open ? <div className="border-t border-[var(--line)] px-3 py-3">{grid}</div> : null}
    </div>
  );
}
