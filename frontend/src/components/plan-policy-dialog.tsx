"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import {
  PLAN_RULES,
  convertGateBody,
  convertGateTitle,
  type ConvertGate,
} from "@/lib/plans";
import { cn } from "@/lib/utils";

type PlanPolicyDialogProps = {
  gate: ConvertGate;
  onClose: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  loginHref?: string;
};

export function PlanPolicyDialog({
  gate,
  onClose,
  secondaryLabel,
  onSecondary,
  loginHref = "/login",
}: PlanPolicyDialogProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const needLogin = gate === "login" || gate === "plan";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklab,var(--ink)_28%,transparent)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-policy-title"
        className="panel w-full max-w-lg rounded-3xl px-6 py-5"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p id="plan-policy-title" className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
              {convertGateTitle(gate)}
            </p>
            <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{convertGateBody(gate)}</p>
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

        {gate === "login" ? (
          <div className="mt-4 rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)]/50 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                Free · Casual
              </p>
              <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white dark:text-[#06281d]">
                Free
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-sm leading-5 text-[var(--ink)]">
              <li>30 conversions / day</li>
              <li>25 AI reading or translation pages / month</li>
              <li>No credit card · document history after sign-in</li>
            </ul>
          </div>
        ) : null}

        <table className="mt-5 w-full border-collapse text-left text-sm">
          <caption className="sr-only">Plan permissions and conversion policy</caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              <th className="pb-2 pr-3 font-medium">Plan</th>
              <th className="pb-2 pr-3 font-medium">Price</th>
              <th className="pb-2 pr-3 font-medium">Convert</th>
              <th className="pb-2 pr-3 font-medium">Quota</th>
              <th className="pb-2 font-medium">Includes</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_RULES.map((plan) => (
              <tr
                key={plan.id}
                className={cn(
                  "border-t border-[var(--line)]",
                  plan.id === "basic" ? "bg-[var(--accent-soft)]/40" : "",
                )}
              >
                <td className="py-2 pr-3 font-medium">
                  {plan.label}
                  {plan.id === "basic" ? (
                    <span className="ml-1.5 inline-flex rounded-full bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-white dark:text-[#06281d]">
                      Free
                    </span>
                  ) : null}
                </td>
                <td
                  className={cn(
                    "py-2 pr-3",
                    plan.free ? "font-semibold text-[var(--accent-strong)]" : "text-[var(--ink-muted)]",
                  )}
                >
                  {plan.price ?? "—"}
                </td>
                <td className="py-2 pr-3 text-[var(--ink-muted)]">{plan.convert}</td>
                <td className="py-2 pr-3 text-[var(--ink-muted)]">{plan.quota}</td>
                <td className="py-2 text-[var(--ink-muted)]">{plan.extras}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
          <a
            href="/pricing"
            className="mr-auto rounded-full px-3 py-1.5 text-sm font-medium text-[var(--accent-strong)] transition hover:bg-[var(--accent-soft)] hover:underline"
          >
            See Free Casual &amp; paid roles
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-sm text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
          >
            Close
          </button>
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              onClick={() => {
                onSecondary();
                onClose();
              }}
              className="rounded-full border border-[var(--line)] px-4 py-2 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
            >
              {secondaryLabel}
            </button>
          ) : null}
          {needLogin ? (
            <a
              href={loginHref}
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white dark:text-[#06281d]"
            >
              {gate === "login" ? "Start free with Casual" : "Sign in"}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
