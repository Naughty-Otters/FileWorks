"use client";

import { useEffect, useState } from "react";
import { fetchMe, logoutSession, upgradePlan, type MeResponse } from "@/lib/api";
import { ThemeToggle } from "@/components/theme-toggle";
import { canSwitchPlan, PERMISSION_LABELS, PLAN_CATALOG, planSwitchLabel } from "@/lib/plans";
import { cn } from "@/lib/utils";

function usageLine(used: number, limit: number | null, remaining: number | null, period: string) {
  if (limit == null) return `Unlimited ${period}`;
  return `${used} / ${limit} ${period} · ${remaining ?? 0} left`;
}

function usagePercent(used: number, limit: number | null) {
  if (limit == null || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function ProfilePage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    void fetchMe()
      .then((session) => {
        setMe(session);
        if (!session.user) window.location.assign("/login?next=/profile");
      })
      .catch(() => window.location.assign("/login?next=/profile"));
  }, []);

  async function onUpgrade(plan: string) {
    setPending(plan);
    setError(null);
    try {
      setMe(await upgradePlan(plan));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan change failed");
    } finally {
      setPending(null);
    }
  }

  if (!me?.user) {
    return (
      <div className="app-shell relative">
        <div className="atmosphere" aria-hidden />
        <p className="relative z-10 p-8 text-sm text-[var(--ink-muted)]">Loading account…</p>
      </div>
    );
  }

  const name = me.user.name || me.user.email;
  const initial = name.slice(0, 1).toUpperCase();
  const current = PLAN_CATALOG.find((plan) => plan.id === me.plan);

  return (
    <div className="app-shell relative">
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <a href="/" className="font-[family-name:var(--font-display)] text-xl tracking-tight md:text-2xl">
            FileWorks
          </a>
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle className="h-8 w-8" />
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 md:px-6">
        <div className="panel rounded-3xl px-6 py-6">
          <div className="flex items-center gap-4">
            {me.user.picture_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={me.user.picture_url} alt="" className="h-14 w-14 rounded-full" />
            ) : (
              <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-[var(--accent-soft)] text-lg font-medium text-[var(--accent-strong)]">
                {initial}
              </span>
            )}
            <div className="min-w-0">
              <p className="font-[family-name:var(--font-display)] text-2xl tracking-tight">{name}</p>
              <p className="truncate text-sm text-[var(--ink-muted)]">{me.user.email}</p>
            </div>
            <span className="ml-auto rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium uppercase tracking-wide text-[var(--accent-strong)]">
              {me.plan}
            </span>
          </div>
        </div>

        <section className="panel rounded-3xl px-6 py-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl tracking-tight">Usage</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {current?.quota || "Plan allowance for conversions."}
          </p>
          <dl className="mt-5 space-y-4">
            {me.quota.limit_day != null ? (
              <div>
                <div className="flex justify-between text-sm">
                  <dt>Today</dt>
                  <dd className="text-[var(--ink-muted)]">
                    {usageLine(me.quota.used_day, me.quota.limit_day, me.quota.remaining_day, "today")}
                  </dd>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${usagePercent(me.quota.used_day, me.quota.limit_day)}%` }}
                  />
                </div>
              </div>
            ) : null}
            {me.quota.limit_month != null ? (
              <div>
                <div className="flex justify-between text-sm">
                  <dt>This month</dt>
                  <dd className="text-[var(--ink-muted)]">
                    {usageLine(me.quota.used_month, me.quota.limit_month, me.quota.remaining_month, "this month")}
                  </dd>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${usagePercent(me.quota.used_month, me.quota.limit_month)}%` }}
                  />
                </div>
              </div>
            ) : null}
            {me.quota.limit_day == null && me.quota.limit_month == null ? (
              <p className="text-sm text-[var(--ink-muted)]">No conversion quota on this plan.</p>
            ) : null}
          </dl>
        </section>

        <section className="panel rounded-3xl px-6 py-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl tracking-tight">Role</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {current?.blurb || "Signed-in FileWorks account."}
          </p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {Object.entries(PERMISSION_LABELS).map(([key, label]) => (
              <li
                key={key}
                className={cn(
                  "rounded-full px-3 py-1 text-xs",
                  me.permissions[key]
                    ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                    : "bg-[color-mix(in_oklab,var(--ink)_6%,transparent)] text-[var(--ink-muted)] line-through",
                )}
              >
                {label}
              </li>
            ))}
          </ul>
        </section>

        <section className="panel rounded-3xl px-6 py-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl tracking-tight">Plan</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Switch plans anytime. The change applies to this account immediately.
          </p>
          {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {PLAN_CATALOG.map((plan) => {
              const currentPlan = plan.id === me.plan;
              const switchable = canSwitchPlan(me.plan, plan.id);
              return (
                <article
                  key={plan.id}
                  className={cn(
                    "flex flex-col rounded-2xl border px-4 py-4",
                    currentPlan ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]",
                  )}
                >
                  <p className="text-sm font-medium">{plan.label}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">{plan.quota}</p>
                  <ul className="mt-3 flex-1 space-y-1 text-xs text-[var(--ink-muted)]">
                    {plan.features.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {currentPlan ? (
                    <p className="mt-4 text-xs font-medium text-[var(--accent-strong)]">Current plan</p>
                  ) : (
                    <button
                      type="button"
                      disabled={!switchable || pending !== null}
                      onClick={() => onUpgrade(plan.id)}
                      className="mt-4 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-45 dark:text-[#06281d]"
                    >
                      {pending === plan.id ? "Updating…" : planSwitchLabel(me.plan, plan)}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <div className="flex items-center justify-between px-1">
          <a href="/" className="text-sm text-[var(--ink-muted)] hover:text-[var(--accent-strong)]">
            Back to workspace
          </a>
          <button
            type="button"
            onClick={async () => {
              await logoutSession();
              window.location.assign("/");
            }}
            className="text-sm text-[var(--ink-muted)] hover:text-[var(--accent-strong)]"
          >
            Sign out
          </button>
        </div>
      </main>
    </div>
  );
}
