"use client";

import { useEffect, useRef, useState } from "react";
import { BrandLockup } from "@/components/brand-lockup";
import { AuthBar } from "@/components/auth-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";
import { MarketingNav } from "@/components/marketing-nav";
import { BillingIntervalToggle } from "@/components/billing-interval-toggle";
import {
  confirmCheckout,
  fetchBillingCatalog,
  fetchMe,
  startCheckout,
  syncBilling,
  type BillingCatalog,
} from "@/lib/api";
import { reloadSession, setSessionMe, useSession } from "@/lib/session";
import { SeoFaq } from "@/components/seo-faq";
import { JsonLd } from "@/components/json-ld";
import {
  API_PLAN_CATALOG,
  PUBLIC_API_PLANS,
  apiFreeQuotaSentence,
  apiPlanSwitchLabel,
  canMoveToApiPlan,
  formatPlanPriceForInterval,
  PLAN_CATALOG,
  planIsPurchasable,
  planSwitchLabel,
  PRICE_ROLES,
  usageFitsPlan,
  usageOverLimitReasons,
} from "@/lib/plans";
import {
  checkoutCanceledNotice,
  equivalentMonthlyLabel,
  YEARLY_DISCOUNT,
  type BillingInterval,
} from "@/lib/plan-quotas";
import { faqJsonLd, organizationJsonLd, PRICING_FAQS, softwareApplicationJsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/legal";
import { cn } from "@/lib/utils";

function loginNext(path: string) {
  return `/login?next=${encodeURIComponent(path)}`;
}

function parseInterval(raw: string | null): BillingInterval {
  return raw === "year" ? "year" : "month";
}

export function PricingPage() {
  const { status: authStatus, me, displayUser } = useSession();
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("month");
  const handledReturn = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setBillingInterval(parseInterval(params.get("interval")));
  }, []);

  useEffect(() => {
    void Promise.all([reloadSession(), fetchBillingCatalog().catch(() => null)]).then(async ([session, cat]) => {
      setCatalog(cat);
      if (handledReturn.current) return;
      const params = new URLSearchParams(window.location.search);
      if (params.get("billing") === "return" && session.user) {
        handledReturn.current = true;
        try {
          const next = await syncBilling();
          setSessionMe(next);
          setNotice(
            next.billing?.cancel_at_period_end
              ? "Billing updated. This role stays until the period ends, then Casual."
              : "Billing updated from Stripe.",
          );
        } catch {
          setNotice("Returned from Stripe. Refresh if your role looks stale.");
        }
        return;
      }
      if (params.get("checkout") === "success") {
        handledReturn.current = true;
        const sessionId = params.get("session_id");
        if (sessionId && session.user) {
          try {
            await confirmCheckout(sessionId);
            setSessionMe(await syncBilling().catch(() => fetchMe()));
            setNotice("Payment received. Your role is updated.");
            return;
          } catch {
            try {
              setSessionMe(await syncBilling());
            } catch {
              // Webhook may still apply the role.
            }
          }
        }
        setNotice("Payment received. Your role updates when Stripe confirms the subscription.");
        return;
      }
      if (params.get("checkout") === "cancel") {
        handledReturn.current = true;
        setNotice(checkoutCanceledNotice());
        return;
      }
      const subscribe = params.get("subscribe");
      const checkoutInterval = parseInterval(params.get("interval"));
      const apiIds = API_PLAN_CATALOG.map((plan) => plan.id);
      if (
        session.user &&
        subscribe &&
        (subscribe === "pro" || subscribe === "premium" || apiIds.includes(subscribe as (typeof apiIds)[number])) &&
        cat?.enabled &&
        (cat.prices[subscribe] || cat.api?.prices?.[subscribe])
      ) {
        handledReturn.current = true;
        await goCheckout(subscribe, checkoutInterval);
      }
    }).catch(() => undefined);
  }, []);

  async function goCheckout(plan: string, chosenInterval: BillingInterval = billingInterval) {
    setPending(plan);
    setError(null);
    try {
      const checkout = await startCheckout(plan, "/pricing", chosenInterval);
      if (!checkout.url) {
        throw new Error("Stripe did not return a billing URL");
      }
      window.location.assign(checkout.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setPending(null);
    }
  }

  function monthlyAmountFor(id: string, fallbackPrice: string): number | null {
    if (id === "anonymous") return 0;
    const amount = catalog?.amounts?.[id] ?? catalog?.api?.amounts?.[id];
    if (typeof amount === "number") return amount;
    const match = fallbackPrice.match(/\$(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function priceFor(id: string, fallback: string) {
    if (fallback === "Free" || id === "anonymous") {
      const amount = monthlyAmountFor(id, fallback);
      if (amount == null || amount <= 0) return "Free";
    }
    const monthly = monthlyAmountFor(id, fallback);
    if (monthly == null) return fallback;
    if (monthly <= 0) return "Free";
    if (billingInterval === "year") {
      const yearly = catalog?.yearly_amounts?.[id] ?? catalog?.api?.yearly_amounts?.[id];
      if (typeof yearly === "number" && yearly > 0) return `$${yearly} / year`;
    }
    return formatPlanPriceForInterval(monthly, billingInterval);
  }

  function priceHint(id: string, fallback: string) {
    const monthly = monthlyAmountFor(id, fallback);
    if (monthly == null || monthly <= 0 || billingInterval !== "year") return null;
    return equivalentMonthlyLabel(monthly);
  }

  const savePct = Math.round((catalog?.yearly_discount ?? YEARLY_DISCOUNT) * 100);
  const subscribeQuery = (planId: string) =>
    `/pricing?subscribe=${planId}${billingInterval === "year" ? "&interval=year" : ""}`;

  return (
    <div className="app-shell relative">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            organizationJsonLd(),
            softwareApplicationJsonLd(),
            {
              "@type": "WebPage",
              "@id": `${SITE_URL}/pricing`,
              url: `${SITE_URL}/pricing`,
              name: "Pricing — FileWorks",
              isPartOf: { "@id": `${SITE_URL}/#website` },
            },
            { ...faqJsonLd(PRICING_FAQS), "@id": `${SITE_URL}/pricing#faq` },
          ],
        }}
      />
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <BrandLockup />
          <MarketingNav>
            <AuthBar
              me={me}
              status={authStatus}
              user={displayUser}
              loginHref={loginNext("/pricing")}
            />
            <ThemeToggle className="h-8 w-8" />
          </MarketingNav>
        </div>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 md:px-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-tight">
            Prices and roles
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Two products, one account. Convert PDF, Word, Excel, PowerPoint, images, and scans
            in the FileWorks app for free on Casual. Pay only when you need more AI reading or
            translation pages. Editor edits text on PDFs and images; OCR uses the workspace AI
            allowance. Convert API is billed separately: standard pages are free,
            AI is 1 credit per page. You can hold both at once.{" "}
            <a href="/legal#refunds" className="text-[var(--accent-strong)] hover:underline">
              Refunds, cancellation, and contact
            </a>
            .
          </p>
          {notice ? <p className="mt-3 text-sm text-[var(--ink-muted)]">{notice}</p> : null}
          {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
        </div>

        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
          <BillingIntervalToggle value={billingInterval} onChange={setBillingInterval} />
          <p className="max-w-xs text-xs leading-5 text-[var(--ink-muted)] sm:pb-1.5 sm:text-right">
            {billingInterval === "year"
              ? `Prices below are yearly totals (${savePct}% off 12 months). Allowances stay the same.`
              : "Prices below are monthly. Switch to yearly anytime for the discount."}
          </p>
        </div>

        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Workspace</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            File conversions in the app.{" "}
            <span className="font-medium text-[var(--accent-strong)]">Guest and Casual are Free</span>
            — no card required. Daily is $5/mo. Expert is the volume plan.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PRICE_ROLES.map((item) => {
            const signedIn = Boolean(me?.user);
            const current = signedIn && me?.plan === item.id;
            const catalogPlan = PLAN_CATALOG.find((plan) => plan.id === item.id);
            const paidPlan = item.id === "pro" || item.id === "premium";
            const purchasable = planIsPurchasable(item.id, catalog);
            const usageOk = !signedIn || !me || usageFitsPlan(me.quota, item.id);
            const stripeReady = Boolean(catalog?.enabled && paidPlan && purchasable && !current && usageOk);
            const blockedByUsage = Boolean(
              signedIn && catalog?.enabled && paidPlan && purchasable && !current && !usageOk,
            );
            const actionLabel =
              signedIn && catalogPlan ? planSwitchLabel(me?.plan || "anonymous", catalogPlan) : item.cta.label;
            const usageBlock = me ? usageOverLimitReasons(me.quota, item.id) : [];
            const isFree = Boolean(item.free) || item.price === "Free";
            const hint = isFree ? null : priceHint(item.id, item.price);
            return (
              <article
                key={item.id}
                className={cn(
                  "panel flex flex-col rounded-3xl px-5 py-5",
                  item.highlight ? "border-[var(--accent)] bg-[var(--accent-soft)]/40" : "",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p
                      className={cn(
                        "text-[11px] uppercase tracking-[0.14em]",
                        isFree ? "font-semibold text-[var(--accent-strong)]" : "text-[var(--ink-muted)]",
                      )}
                    >
                      {priceFor(item.id, item.price)}
                    </p>
                    {hint ? <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">{hint}</p> : null}
                  </div>
                  {isFree ? (
                    <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white dark:text-[#06281d]">
                      Free
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 font-[family-name:var(--font-display)] text-2xl tracking-tight">{item.role}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{item.blurb}</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm text-[var(--ink-muted)]">
                  {item.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {current ? (
                  <p className="mt-5 text-center text-sm font-medium text-[var(--accent-strong)]">Current role</p>
                ) : item.id === "anonymous" ? (
                  <a
                    href="/"
                    className="mt-5 inline-flex justify-center rounded-full border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--accent-soft)]"
                  >
                    {item.cta.label}
                  </a>
                ) : !signedIn ? (
                  <a
                    href={loginNext(stripeReady ? subscribeQuery(item.id) : "/pricing")}
                    className={cn(
                      "mt-5 inline-flex justify-center rounded-full px-3 py-2 text-sm font-medium",
                      item.highlight
                        ? "bg-[var(--accent)] text-white dark:text-[#06281d]"
                        : "border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--accent-soft)]",
                    )}
                  >
                    {item.cta.label}
                  </a>
                ) : stripeReady ? (
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void goCheckout(item.id)}
                    className={cn(
                      "mt-5 inline-flex justify-center rounded-full px-3 py-2 text-sm font-medium",
                      item.highlight
                        ? "bg-[var(--accent)] text-white dark:text-[#06281d]"
                        : "border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--accent-soft)]",
                      "disabled:cursor-not-allowed disabled:opacity-45",
                    )}
                  >
                    {pending === item.id ? "Redirecting…" : actionLabel}
                  </button>
                ) : blockedByUsage ? (
                  <div className="mt-5">
                    <button
                      type="button"
                      disabled
                      className="inline-flex w-full justify-center rounded-full border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink)] opacity-45"
                    >
                      {actionLabel}
                    </button>
                    <p className="mt-2 text-center text-xs leading-4 text-[var(--ink-muted)]">
                      Usage is over this plan: {usageBlock.join("; ")}.
                    </p>
                  </div>
                ) : (
                  <a
                    href="/profile"
                    className={cn(
                      "mt-5 inline-flex justify-center rounded-full px-3 py-2 text-sm font-medium",
                      item.highlight
                        ? "bg-[var(--accent)] text-white dark:text-[#06281d]"
                        : "border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--accent-soft)]",
                    )}
                  >
                    {item.cta.label}
                  </a>
                )}
              </article>
            );
          })}
        </div>

        <div>
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Convert API</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Separate product. Authenticate with a key from Profile. Standard convert is free
            (monthly page cap). AI reading, translation, or Design auto-fill is 1 credit per
            page.{" "}
            <span className="font-medium text-[var(--accent-strong)]">API Free</span> starts at
            {` ${apiFreeQuotaSentence()} `}with no card. Combines with any
            workspace role.{" "}
            <a href="/docs" className="text-[var(--accent-strong)] hover:underline">
              API docs
            </a>
            .
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PUBLIC_API_PLANS.map((item) => {
            const signedIn = Boolean(me?.user);
            const current = signedIn && (me?.api_plan || "api_free") === item.id;
            const paidPlan = item.id !== "api_free";
            const isFree = !paidPlan || item.price === "Free";
            const purchasable = planIsPurchasable(item.id, {
              enabled: catalog?.enabled,
              prices: catalog?.api?.prices,
              amounts: catalog?.api?.amounts,
            });
            const usageOk =
              !signedIn || !me || canMoveToApiPlan(me.api_plan || "api_free", item.id, me.api_quota) || current;
            const stripeReady = Boolean(catalog?.enabled && paidPlan && purchasable && !current && usageOk);
            const actionLabel = signedIn
              ? apiPlanSwitchLabel(me?.api_plan || "api_free", item)
              : item.id === "api_free"
                ? "Get a free key"
                : `Choose ${item.label}`;
            const hint = isFree ? null : priceHint(item.id, item.price);
            return (
              <article
                key={item.id}
                className={cn(
                  "panel flex flex-col rounded-3xl px-5 py-5",
                  item.highlight ? "border-[var(--accent)] bg-[var(--accent-soft)]/40" : "",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p
                      className={cn(
                        "text-[11px] uppercase tracking-[0.14em]",
                        isFree ? "font-semibold text-[var(--accent-strong)]" : "text-[var(--ink-muted)]",
                      )}
                    >
                      {priceFor(item.id, item.price)}
                    </p>
                    {hint ? <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">{hint}</p> : null}
                  </div>
                  {isFree ? (
                    <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white dark:text-[#06281d]">
                      Free
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 font-[family-name:var(--font-display)] text-2xl tracking-tight">{item.label}</p>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{item.blurb}</p>
                <ul className="mt-4 flex-1 space-y-1.5 text-sm text-[var(--ink-muted)]">
                  {item.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                {current ? (
                  <p className="mt-5 text-center text-sm font-medium text-[var(--accent-strong)]">Current API plan</p>
                ) : !signedIn ? (
                  <a
                    href={loginNext(stripeReady ? subscribeQuery(item.id) : "/docs")}
                    className={cn(
                      "mt-5 inline-flex justify-center rounded-full px-3 py-2 text-sm font-medium",
                      item.highlight
                        ? "bg-[var(--accent)] text-white dark:text-[#06281d]"
                        : "border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--accent-soft)]",
                    )}
                  >
                    {actionLabel}
                  </a>
                ) : item.id === "api_free" ? (
                  <a
                    href="/profile"
                    className="mt-5 inline-flex justify-center rounded-full bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white dark:text-[#06281d]"
                  >
                    Generate a free key
                  </a>
                ) : stripeReady ? (
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void goCheckout(item.id)}
                    className={cn(
                      "mt-5 inline-flex justify-center rounded-full px-3 py-2 text-sm font-medium",
                      item.highlight
                        ? "bg-[var(--accent)] text-white dark:text-[#06281d]"
                        : "border border-[var(--line)] text-[var(--ink)] hover:bg-[var(--accent-soft)]",
                      "disabled:cursor-not-allowed disabled:opacity-45",
                    )}
                  >
                    {pending === item.id ? "Redirecting…" : actionLabel}
                  </button>
                ) : (
                  <a
                    href="/profile"
                    className="mt-5 inline-flex justify-center rounded-full border border-[var(--line)] px-3 py-2 text-sm font-medium text-[var(--ink)] hover:bg-[var(--accent-soft)]"
                  >
                    {actionLabel}
                  </a>
                )}
              </article>
            );
          })}
        </div>

        <section className="panel overflow-x-auto rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Role comparison</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">What each price unlocks.</p>
          <table className="mt-5 w-full min-w-[640px] border-collapse text-left text-sm">
            <caption className="sr-only">Price and role comparison</caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                <th className="pb-2 pr-3 font-medium">Price</th>
                <th className="pb-2 pr-3 font-medium">Role</th>
                <th className="pb-2 pr-3 font-medium">Conversions</th>
                <th className="pb-2 pr-3 font-medium">AI / translation</th>
                <th className="pb-2 font-medium">Downloads</th>
              </tr>
            </thead>
            <tbody>
              {PRICE_ROLES.map((item) => (
                <tr
                  key={item.id}
                  className={cn(
                    "border-t border-[var(--line)]",
                    item.free ? "bg-[var(--accent-soft)]/35" : "",
                  )}
                >
                  <td
                    className={cn(
                      "py-2.5 pr-3",
                      item.free ? "font-semibold text-[var(--accent-strong)]" : "text-[var(--ink-muted)]",
                    )}
                  >
                    {priceFor(item.id, item.price)}
                    {item.free ? (
                      <span className="ml-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-strong)]">
                        Free
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 pr-3 font-medium">{item.role}</td>
                  <td className="py-2.5 pr-3 text-[var(--ink-muted)]">{item.quota}</td>
                  <td className="py-2.5 pr-3 text-[var(--ink-muted)]">{item.ai}</td>
                  <td className="py-2.5 text-[var(--ink-muted)]">{item.history}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <SeoFaq items={PRICING_FAQS} />
      </main>
      <SiteFooter />
    </div>
  );
}
