"use client";

import { useEffect, useState } from "react";
import { getAccessToken } from "@/lib/auth";
import { reloadSession, useSession } from "@/lib/session";
import { resolveGoogleClientId } from "@/lib/google-gis";
import { GoogleSignIn } from "@/components/google-sign-in";
import { BrandLockup } from "@/components/brand-lockup";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";
import { MarketingNav } from "@/components/marketing-nav";
import { casualLoginBlurb } from "@/lib/plan-quotas";

export function loginRedirectPath(
  search = window.location.search,
  referrer = typeof document === "undefined" ? "" : document.referrer,
): string {
  const next = new URLSearchParams(search).get("next");
  if (next) return next.startsWith("/") && !next.startsWith("//") ? next : "/";
  // Most "Sign in" links carry no ?next=, so fall back to the page that sent us
  // here. Same-origin only, and never back to /login itself.
  return sameOriginPath(referrer);
}

function sameOriginPath(referrer: string): string {
  if (!referrer || typeof window === "undefined") return "/";
  try {
    const url = new URL(referrer);
    if (url.origin !== window.location.origin) return "/";
    if (url.pathname.replace(/\/$/, "") === "/login") return "/";
    return `${url.pathname}${url.search}${url.hash}` || "/";
  } catch {
    return "/";
  }
}

function redirectAfterLogin() {
  window.location.assign(loginRedirectPath());
}

export function LoginScreen() {
  const { me } = useSession();
  const [sessionReady, setSessionReady] = useState(false);
  const clientId = resolveGoogleClientId(me?.google_client_id);

  useEffect(() => {
    void reloadSession()
      .then((session) => {
        if (session.user) redirectAfterLogin();
      })
      .catch(() => undefined)
      .finally(() => setSessionReady(true));
  }, []);

  // Google's popup/FedCM flow can hand back a credential without our callback
  // completing its navigation. Re-check whenever the tab regains focus so a
  // signed-in user is never stranded on this page.
  useEffect(() => {
    function recheck() {
      if (document.visibilityState === "hidden" || !getAccessToken()) return;
      void reloadSession()
        .then((session) => {
          if (session.user) redirectAfterLogin();
        })
        .catch(() => undefined);
    }
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  return (
    <div className="app-shell relative">
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <BrandLockup />
          <MarketingNav>
            <ThemeToggle />
          </MarketingNav>
        </div>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-[1500px] flex-1 items-center justify-center px-4 py-12 md:px-6">
        <div className="panel w-full max-w-md rounded-3xl px-8 py-10">
          <p className="font-[family-name:var(--font-display)] text-3xl tracking-tight">Sign in</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Use Google to authenticate to this FileWorks URL. Conversion requires a signed-in account.
          </p>
          <div className="mt-5 rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)]/50 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">
                Free · Casual
              </p>
              <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white dark:text-[#06281d]">
                Free
              </span>
            </div>
            <p className="mt-1.5 text-sm leading-5 text-[var(--ink)]">
              {casualLoginBlurb()}
            </p>
          </div>
          <div className="mt-8">
            {!sessionReady ? (
              <p className="text-sm text-[var(--ink-muted)]">Checking sign-in…</p>
            ) : (
              <GoogleSignIn
                clientId={clientId}
                size="large"
                onSignedIn={redirectAfterLogin}
              />
            )}
          </div>
          {sessionReady && !clientId ? (
            <p className="mt-4 text-xs leading-5 text-[var(--ink-muted)]">
              Add this origin to the Google OAuth client&apos;s Authorized JavaScript origins, and set
              GOOGLE_CLIENT_ID on the API.
            </p>
          ) : null}
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <a
              href="/"
              className="text-sm text-[var(--ink-muted)] transition hover:text-[var(--accent-strong)]"
            >
              Continue as guest
            </a>
            <a
              href="/pricing"
              className="text-sm font-medium text-[var(--accent-strong)] transition hover:underline"
            >
              See Free Casual &amp; paid roles
            </a>
          </div>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
