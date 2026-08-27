"use client";

import { YEARLY_DISCOUNT, type BillingInterval } from "@/lib/plan-quotas";
import { cn } from "@/lib/utils";

const SAVE_PCT = Math.round(YEARLY_DISCOUNT * 100);

type Props = {
  value: BillingInterval;
  onChange: (next: BillingInterval) => void;
  className?: string;
  /** Optional id prefix for aria controls. */
  id?: string;
};

/**
 * Labeled monthly / yearly choice. Options read as buttons: border, hover, selected fill.
 */
export function BillingIntervalToggle({ value, onChange, className, id = "billing-interval" }: Props) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p id={`${id}-label`} className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--ink-muted)]">
        How you pay
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="grid max-w-md grid-cols-2 gap-2"
      >
        <Option
          id={`${id}-month`}
          selected={value === "month"}
          onSelect={() => onChange("month")}
          title="Monthly"
          detail="Billed every month"
        />
        <Option
          id={`${id}-year`}
          selected={value === "year"}
          onSelect={() => onChange("year")}
          title="Yearly"
          detail={`${SAVE_PCT}% off · one bill a year`}
          badge={`Save ${SAVE_PCT}%`}
        />
      </div>
    </div>
  );
}

function Option({
  id,
  selected,
  onSelect,
  title,
  detail,
  badge,
}: {
  id: string;
  selected: boolean;
  onSelect: () => void;
  title: string;
  detail: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      id={id}
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer flex-col items-start gap-1 rounded-2xl border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow,transform] duration-150",
        "hover:-translate-y-px active:translate-y-0",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-[var(--line)] bg-[var(--panel)] hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--line))] hover:bg-[var(--accent-soft)]/35",
      )}
    >
      <span className="flex w-full items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2",
            selected
              ? "border-[var(--accent)] bg-[var(--accent)]"
              : "border-[var(--ink-muted)] bg-transparent",
          )}
        >
          {selected ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--panel)]" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className={cn("text-sm tracking-tight", selected ? "font-semibold text-[var(--ink)]" : "font-medium text-[var(--ink)]")}>
              {title}
            </span>
            {badge ? (
              <span className="rounded-md bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white dark:text-[#06281d]">
                {badge}
              </span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-[11px] leading-4 text-[var(--ink-muted)]">{detail}</span>
        </span>
      </span>
    </button>
  );
}
