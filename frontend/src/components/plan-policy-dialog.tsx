"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import {
  PLAN_RULES,
  convertGateBody,
  convertGateTitle,
  type ConvertGate,
} from "@/lib/plans";

type PlanPolicyDialogProps = {
  gate: ConvertGate;
  onClose: () => void;
};

export function PlanPolicyDialog({ gate, onClose }: PlanPolicyDialogProps) {
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
        <table className="mt-5 w-full border-collapse text-left text-sm">
          <caption className="sr-only">Plan permissions and conversion policy</caption>
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              <th className="pb-2 pr-3 font-medium">Plan</th>
              <th className="pb-2 pr-3 font-medium">Convert</th>
              <th className="pb-2 pr-3 font-medium">Quota</th>
              <th className="pb-2 font-medium">Includes</th>
            </tr>
          </thead>
          <tbody>
            {PLAN_RULES.map((plan) => (
              <tr key={plan.id} className="border-t border-[var(--line)]">
                <td className="py-2 pr-3 font-medium">{plan.label}</td>
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
            className="mr-auto rounded-full px-3 py-1.5 text-sm text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
          >
            Prices and roles
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-3 py-1.5 text-sm text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
          >
            Close
          </button>
          {needLogin ? (
            <a
              href="/login"
              className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white dark:text-[#06281d]"
            >
              Sign in
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
