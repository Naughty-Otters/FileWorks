"use client";

import { useEffect, useRef, useState } from "react";
import { BrandLockup } from "@/components/brand-lockup";
import { AuthBar } from "@/components/auth-bar";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";
import { MarketingNav } from "@/components/marketing-nav";
import {
  confirmCheckout,
  fetchBillingCatalog,
  fetchMe,
  startCheckout,
  type BillingCatalog,
  type MeResponse,
} from "@/lib/api";
import { formatPlanPrice, planRank, PRICE_ROLES } from "@/lib/plans";
import { cn } from "@/lib/utils";

function loginNext(path: string) {
  return `/login?next=${encodeURIComponent(path)}`;
}

export function PricingPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [catalog, setCatalog] = useState<BillingCatalog | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handledReturn = useRef(false);

  useEffect(() => {
    void Promise.all([fetchMe(), fetchBillingCatalog().catch(() => null)]).then(async ([session, cat]) => {
      setMe(session);
      setCatalog(cat);
      if (handledReturn.current) return;
      const params = new URLSearchParams(window.location.search);
      if (params.get("checkout") === "success") {
        handledReturn.current = true;
        const sessionId = params.get("session_id");
        if (sessionId && session.user) {
          try {
            await confirmCheckout(sessionId);
            setMe(await fetchMe());
            setNotice("Payment received. Your role is updated.");
            return;
          } catch {
            // Webhook may still apply the role if confirm is unavailable.
          }
        }
        setNotice("Payment received. Your role updates when Stripe confirms the subscription.");
        return;
      }
      if (params.get("checkout") === "cancel") {
        handledReturn.current = true;
        setNotice("Checkout canceled. Your current plan is unchanged.");
        return;
      }
      const subscribe = params.get("subscribe");
      if (
        session.user &&
        (subscribe === "pro" || subscribe === "premium") &&
        cat?.enabled &&
        cat.prices[subscribe]
      ) {
        handledReturn.current = true;
        await goCheckout(subscribe);
      }
    });
  }, []);

  async function goCheckout(plan: string) {
    setPending(plan);
    setError(null);
    try {
      const checkout = await startCheckout(plan, "/pricing");
      if (checkout.url) {
        window.location.assign(checkout.url);
        return;
      }
      setMe(await fetchMe());
      setNotice(`You're on ${checkout.plan || plan}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setPending(null);
    }
  }

  function priceFor(id: string, fallback: string) {
    if (id === "anonymous") return "Free";
    const amount = catalog?.amounts?.[id];
    if (typeof amount === "number") return formatPlanPrice(amount);
    return fallback;
  }

  return (
    <div className="app-shell relative">
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <BrandLockup />
          <MarketingNav>
            <AuthBar me={me} loginHref={loginNext("/pricing")} />
            <ThemeToggle className="h-8 w-8" />
          </MarketingNav>
        </div>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-10 md:px-6">
        <div>
          <p className="font-[family-name:var(--font-display)] text-4xl tracking-tight">Prices and roles</p>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--ink-muted)]">
            Each pay grade maps to a FileWorks role. Convert PDF, office, Markdown, TXT, and
            scans to editable Markdown — with AI reading and translation in the same pass. Guest and
            Basic are free. Pro and Premium are monthly subscriptions.{" "}
            <a href="/legal#refunds" className="text-[var(--accent-strong)] hover:underline">
              Refunds, cancellation, and contact
            </a>
            .
          </p>
          {notice ? <p className="mt-3 text-sm text-[var(--ink-muted)]">{notice}</p> : null}
          {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {PRICE_ROLES.map((item) => {
            const signedIn = Boolean(me?.user);
            const current = signedIn && me?.plan === item.id;
            const stripeReady =
              Boolean(catalog?.enabled && catalog.prices[item.id]) &&
              (item.id === "pro" || item.id === "premium") &&
              planRank(item.id) > planRank(me?.plan || "anonymous");
            return (
              <article
                key={item.id}
                className={cn(
                  "panel flex flex-col rounded-3xl px-5 py-5",
                  item.highlight ? "border-[var(--accent)]" : "",
                )}
              >
                <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  {priceFor(item.id, item.price)}
                </p>
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
                    href={loginNext(stripeReady ? `/pricing?subscribe=${item.id}` : "/pricing")}
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
                    {pending === item.id ? "Redirecting…" : item.cta.label}
                  </button>
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
                <tr key={item.id} className="border-t border-[var(--line)]">
                  <td className="py-2.5 pr-3 text-[var(--ink-muted)]">{priceFor(item.id, item.price)}</td>
                  <td className="py-2.5 pr-3 font-medium">{item.role}</td>
                  <td className="py-2.5 pr-3 text-[var(--ink-muted)]">{item.quota}</td>
                  <td className="py-2.5 pr-3 text-[var(--ink-muted)]">{item.ai}</td>
                  <td className="py-2.5 text-[var(--ink-muted)]">{item.history}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
