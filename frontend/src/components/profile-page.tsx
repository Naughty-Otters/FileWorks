"use client";

import { useEffect, useState } from "react";
import {
  confirmCheckout,
  createApiKey,
  fetchMe,
  listApiKeys,
  logoutSession,
  openBillingPortal,
  revokeApiKey,
  startCheckout,
  syncBilling,
  upgradeApiPlan,
  upgradePlan,
  type ApiKeyPublic,
  type CreatedApiKey,
  type MeResponse,
} from "@/lib/api";
import { BrandLockup } from "@/components/brand-lockup";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";
import { MarketingNav } from "@/components/marketing-nav";
import { canMoveToApiPlan, canMoveToPlan, formatPlanPrice, PERMISSION_LABELS, PLAN_CATALOG, API_PLAN_CATALOG, apiPlanSwitchLabel, apiUsageOverLimitReasons, planIsPurchasable, planSwitchLabel, usageOverLimitReasons } from "@/lib/plans";
import { cn } from "@/lib/utils";

function usageLine(used: number, limit: number | null, remaining: number | null, period: string) {
  if (limit == null) return `Unlimited ${period}`;
  return `${used} / ${limit} ${period} · ${remaining ?? 0} left`;
}

function usagePercent(used: number, limit: number | null) {
  if (limit == null || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function formatPeriodEnd(iso: string | null | undefined) {
  if (!iso) return "the end of this period";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "the end of this period";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ProfilePage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null);
  const [keyName, setKeyName] = useState("");
  const [keyCopied, setKeyCopied] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (checkout === "cancel") setNotice("Checkout canceled. Your current plan is unchanged.");
    const fromPortal = params.get("billing") === "return";
    void (fromPortal ? syncBilling() : fetchMe())
      .then(async (session) => {
        if (!session.user) {
          window.location.assign("/login?next=/profile");
          return;
        }
        const sessionId = params.get("session_id");
        if (checkout === "success" && sessionId) {
          try {
            await confirmCheckout(sessionId);
            setMe(await syncBilling().catch(() => fetchMe()));
            setNotice("Payment received. Your role is updated.");
            return;
          } catch {
            try {
              setMe(await syncBilling());
              setNotice("Payment received. Your role is updated.");
              return;
            } catch {
              setNotice("Payment received. Your role updates when Stripe confirms the subscription.");
            }
          }
        } else if (checkout === "success") {
          setNotice("Payment received. Your role updates when Stripe confirms the subscription.");
        } else if (fromPortal) {
          setNotice(
            session.billing?.cancel_at_period_end
              ? `Billing updated. This role stays until ${formatPeriodEnd(session.billing.current_period_end)}, then Basic.`
              : "Billing updated from Stripe.",
          );
        }
        setMe(session);
      })
      .catch(() => window.location.assign("/login?next=/profile"));
  }, []);

  useEffect(() => {
    if (!me?.user) return;
    void listApiKeys()
      .then(setKeys)
      .catch(() => setKeys([]));
  }, [me?.user?.id]);

  async function onUpgrade(plan: string) {
    setPending(plan);
    setError(null);
    try {
      if (me?.billing?.enabled) {
        const checkout = await startCheckout(plan);
        if (!checkout.url) {
          throw new Error("Stripe did not return a billing URL");
        }
        window.location.assign(checkout.url);
        return;
      }
      setMe(await upgradePlan(plan));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Plan change failed");
    } finally {
      setPending(null);
    }
  }

  async function onManageBilling(product = "workspace") {
    setPending(product === "api" ? "api-portal" : "portal");
    setError(null);
    try {
      const portal = await openBillingPortal(product);
      window.location.assign(portal.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing portal failed");
      setPending(null);
    }
  }

  async function onUpgradeApi(plan: string) {
    setPending(plan);
    setError(null);
    try {
      if (me?.billing?.enabled) {
        const checkout = await startCheckout(plan);
        if (!checkout.url) {
          throw new Error("Stripe did not return a billing URL");
        }
        window.location.assign(checkout.url);
        return;
      }
      setMe(await upgradeApiPlan(plan));
    } catch (err) {
      setError(err instanceof Error ? err.message : "API plan change failed");
    } finally {
      setPending(null);
    }
  }

  async function onCreateKey() {
    setPending("create-key");
    setError(null);
    try {
      const created = await createApiKey(keyName.trim() || undefined);
      setNewKey(created);
      setKeyName("");
      setKeys(await listApiKeys());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create API key");
    } finally {
      setPending(null);
    }
  }

  async function onRevokeKey(id: string) {
    setPending(`revoke-${id}`);
    setError(null);
    try {
      await revokeApiKey(id);
      if (newKey?.id === id) setNewKey(null);
      setKeys(await listApiKeys());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not revoke API key");
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
  const currentApiPlan = API_PLAN_CATALOG.find((plan) => plan.id === (me.api_plan || "api_free"));

  return (
    <div className="app-shell relative">
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <BrandLockup />
          <MarketingNav>
            <ThemeToggle className="h-8 w-8" />
          </MarketingNav>
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
          {me.billing?.cancel_at_period_end ? (
            <p className="mt-4 text-sm text-[var(--ink-muted)]">
              Cancels {formatPeriodEnd(me.billing.current_period_end)}. You keep this role until then,
              then Basic.
            </p>
          ) : null}
        </div>

        <section className="panel rounded-3xl px-6 py-6">
          <h1 className="font-[family-name:var(--font-display)] text-xl tracking-tight">Usage</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {current?.quota || "Plan allowance for conversions."}
            {currentApiPlan ? ` Convert API: ${currentApiPlan.quota}.` : ""}
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
            {me.quota.limit_ai_day != null ? (
              <div>
                <div className="flex justify-between text-sm">
                  <dt>AI / translation today</dt>
                  <dd className="text-[var(--ink-muted)]">
                    {usageLine(me.quota.used_ai_day, me.quota.limit_ai_day, me.quota.remaining_ai_day, "today")}
                  </dd>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${usagePercent(me.quota.used_ai_day, me.quota.limit_ai_day)}%` }}
                  />
                </div>
              </div>
            ) : null}
            {me.quota.limit_ai_month != null ? (
              <div>
                <div className="flex justify-between text-sm">
                  <dt>AI / translation this month</dt>
                  <dd className="text-[var(--ink-muted)]">
                    {usageLine(
                      me.quota.used_ai_month,
                      me.quota.limit_ai_month,
                      me.quota.remaining_ai_month,
                      "this month",
                    )}
                  </dd>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${usagePercent(me.quota.used_ai_month, me.quota.limit_ai_month)}%` }}
                  />
                </div>
              </div>
            ) : null}
            {me.api_quota ? (
              <div>
                <div className="flex justify-between text-sm">
                  <dt>API credits this month</dt>
                  <dd className="text-[var(--ink-muted)]">
                    {usageLine(
                      me.api_quota.used_credits,
                      me.api_quota.limit_credits,
                      me.api_quota.remaining_credits,
                      "this month",
                    )}
                  </dd>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${usagePercent(me.api_quota.used_credits, me.api_quota.limit_credits)}%` }}
                  />
                </div>
              </div>
            ) : null}
            {me.quota.limit_day == null && me.quota.limit_month == null && !me.api_quota ? (
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
            {me.billing?.enabled
              ? "Upgrade anytime. Downgrade when this period's usage fits the lower plan."
              : "Switch plans anytime. A downgrade needs usage within that plan's limits."}
          </p>
          {notice ? <p className="mt-3 text-sm text-[var(--ink-muted)]">{notice}</p> : null}
          {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            {PLAN_CATALOG.map((plan) => {
              const currentPlan = plan.id === me.plan;
              const switchable =
                planIsPurchasable(plan.id, me.billing) && canMoveToPlan(me.plan, plan.id, me.quota);
              const usageBlock = usageOverLimitReasons(me.quota, plan.id);
              return (
                <article
                  key={plan.id}
                  className={cn(
                    "flex flex-col rounded-2xl border px-4 py-4",
                    currentPlan ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]",
                  )}
                >
                  <p className="text-sm font-medium">{plan.label}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {typeof me.billing?.amounts?.[plan.id] === "number"
                      ? formatPlanPrice(me.billing.amounts[plan.id])
                      : plan.price}{" "}
                    · {plan.quota}
                  </p>
                  <ul className="mt-3 flex-1 space-y-1 text-xs text-[var(--ink-muted)]">
                    {plan.features.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {currentPlan ? (
                    <p className="mt-4 text-xs font-medium text-[var(--accent-strong)]">
                      {me.billing?.cancel_at_period_end
                        ? `Current · cancels ${formatPeriodEnd(me.billing.current_period_end)}`
                        : "Current plan"}
                    </p>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={!switchable || pending !== null}
                        onClick={() => onUpgrade(plan.id)}
                        className="mt-4 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-45 dark:text-[#06281d]"
                      >
                        {pending === plan.id ? "Updating…" : planSwitchLabel(me.plan, plan)}
                      </button>
                      {!switchable && planIsPurchasable(plan.id, me.billing) && usageBlock.length > 0 ? (
                        <p className="mt-2 text-[11px] leading-4 text-[var(--ink-muted)]">
                          Usage is over this plan: {usageBlock.join("; ")}.
                        </p>
                      ) : null}
                    </>
                  )}
                </article>
              );
            })}
          </div>
          {me.billing?.enabled ? (
            <div className="mt-4">
              <p className="text-xs text-[var(--ink-muted)]">
                Switch Pro and Premium here or in Manage billing. Canceling stops the next charge —
                this period stays paid, with no refund for unused days. The role drops to Basic when
                the paid period ends.{" "}
                <a href="/legal#refunds" className="text-[var(--accent-strong)] hover:underline">
                  Refund and cancellation policy
                </a>
                .
              </p>
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void onManageBilling()}
                className="mt-2 text-sm text-[var(--accent-strong)] hover:underline disabled:opacity-45"
              >
                {pending === "portal" ? "Opening billing…" : "Manage billing"}
              </button>
            </div>
          ) : null}
        </section>

        <section className="panel rounded-3xl px-6 py-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl tracking-tight">API keys</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Keys authenticate <code className="font-[family-name:var(--font-mono)] text-[13px]">POST /api/v1/convert</code>.
            They do not expire. The secret is shown once.{" "}
            <a href="/docs" className="text-[var(--accent-strong)] hover:underline">
              Convert API docs
            </a>
            .
          </p>
          {newKey ? (
            <div className="mt-4 rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3">
              <p className="text-xs font-medium text-[var(--accent-strong)]">Copy this key now. It will not be shown again.</p>
              <p className="mt-2 break-all font-[family-name:var(--font-mono)] text-sm">{newKey.token}</p>
              <button
                type="button"
                className="mt-2 text-xs text-[var(--accent-strong)] hover:underline"
                onClick={async () => {
                  await navigator.clipboard.writeText(newKey.token);
                  setKeyCopied(true);
                  window.setTimeout(() => setKeyCopied(false), 1500);
                }}
              >
                {keyCopied ? "Copied" : "Copy key"}
              </button>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={keyName}
              onChange={(event) => setKeyName(event.target.value)}
              placeholder="Key name (optional)"
              maxLength={64}
              className="min-w-[12rem] flex-1 rounded-full border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm"
            />
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void onCreateKey()}
              className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-45 dark:text-[#06281d]"
            >
              {pending === "create-key" ? "Creating…" : "Generate key"}
            </button>
          </div>
          {keys.length ? (
            <ul className="mt-4 space-y-2">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--line)] px-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{key.name}</p>
                    <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--ink-muted)]">
                      {key.prefix}…{key.last4}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void onRevokeKey(key.id)}
                    className="text-xs text-[var(--ink-muted)] hover:text-[var(--danger)] disabled:opacity-45"
                  >
                    {pending === `revoke-${key.id}` ? "Revoking…" : "Revoke"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[var(--ink-muted)]">No active keys yet.</p>
          )}
        </section>

        <section className="panel rounded-3xl px-6 py-6">
          <h2 className="font-[family-name:var(--font-display)] text-xl tracking-tight">API plan</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Convert API billing is separate from the workspace role. Credits: 1 per page, 3 per page
            with AI or translation. Unused credits do not roll over.
          </p>
          {me.api_quota ? (
            <div className="mt-4">
              <div className="flex justify-between text-sm">
                <p>Credits this month</p>
                <p className="text-[var(--ink-muted)]">
                  {usageLine(
                    me.api_quota.used_credits,
                    me.api_quota.limit_credits,
                    me.api_quota.remaining_credits,
                    "this month",
                  )}
                </p>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--accent-soft)]">
                <div
                  className="h-full rounded-full bg-[var(--accent)]"
                  style={{ width: `${usagePercent(me.api_quota.used_credits, me.api_quota.limit_credits)}%` }}
                />
              </div>
            </div>
          ) : null}
          {me.billing?.api_cancel_at_period_end ? (
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              API plan cancels {formatPeriodEnd(me.billing.api_current_period_end)}. You keep this
              allowance until then, then API Free.
            </p>
          ) : null}
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {API_PLAN_CATALOG.map((plan) => {
              const currentApi = (me.api_plan || "api_free") === plan.id;
              const apiBilling = me.billing?.api ?? me.billing;
              const switchable =
                planIsPurchasable(plan.id, {
                  enabled: me.billing?.enabled,
                  prices: apiBilling?.prices,
                  amounts: apiBilling?.amounts,
                }) && canMoveToApiPlan(me.api_plan || "api_free", plan.id, me.api_quota);
              const usageBlock = apiUsageOverLimitReasons(me.api_quota, plan.id);
              return (
                <article
                  key={plan.id}
                  className={cn(
                    "flex flex-col rounded-2xl border px-4 py-4",
                    currentApi ? "border-[var(--accent)] bg-[var(--accent-soft)]" : "border-[var(--line)]",
                  )}
                >
                  <p className="text-sm font-medium">{plan.label}</p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {typeof me.billing?.api?.amounts?.[plan.id] === "number"
                      ? formatPlanPrice(me.billing.api.amounts[plan.id])
                      : plan.price}{" "}
                    · {plan.quota}
                  </p>
                  <ul className="mt-3 flex-1 space-y-1 text-xs text-[var(--ink-muted)]">
                    {plan.features.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  {currentApi ? (
                    <p className="mt-4 text-xs font-medium text-[var(--accent-strong)]">Current API plan</p>
                  ) : plan.id === "api_free" && me.billing?.enabled ? (
                    <p className="mt-4 text-xs text-[var(--ink-muted)]">
                      Cancel a paid API plan in Manage API billing. It drops to Free at period end.
                    </p>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={!switchable || pending !== null}
                        onClick={() => void onUpgradeApi(plan.id)}
                        className="mt-4 rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-45 dark:text-[#06281d]"
                      >
                        {pending === plan.id ? "Updating…" : apiPlanSwitchLabel(me.api_plan || "api_free", plan)}
                      </button>
                      {!switchable && usageBlock.length > 0 ? (
                        <p className="mt-2 text-[11px] leading-4 text-[var(--ink-muted)]">
                          Usage is over this plan: {usageBlock.join("; ")}.
                        </p>
                      ) : null}
                    </>
                  )}
                </article>
              );
            })}
          </div>
          {me.billing?.enabled ? (
            <button
              type="button"
              disabled={pending !== null}
              onClick={() => void onManageBilling("api")}
              className="mt-4 text-sm text-[var(--accent-strong)] hover:underline disabled:opacity-45"
            >
              {pending === "api-portal" ? "Opening billing…" : "Manage API billing"}
            </button>
          ) : null}
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
      <SiteFooter />
    </div>
  );
}
