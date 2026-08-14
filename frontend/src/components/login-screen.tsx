"use client";

import { useEffect, useState } from "react";
import { fetchMe, type MeResponse } from "@/lib/api";
import { resolveGoogleClientId } from "@/lib/google-gis";
import { GoogleSignIn } from "@/components/google-sign-in";
import { ThemeToggle } from "@/components/theme-toggle";

export function loginRedirectPath(search = window.location.search): string {
  const next = new URLSearchParams(search).get("next") || "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function redirectAfterLogin() {
  window.location.assign(loginRedirectPath());
}

export function LoginScreen() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const clientId = resolveGoogleClientId(me?.google_client_id);

  useEffect(() => {
    void fetchMe()
      .then((session) => {
        setMe(session);
        if (session.user) redirectAfterLogin();
      })
      .catch(() => undefined)
      .finally(() => setSessionReady(true));
  }, []);

  return (
    <div className="app-shell relative">
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <a href="/" className="font-[family-name:var(--font-display)] text-xl tracking-tight md:text-2xl">
            FileWorks
          </a>
          <div className="ml-auto flex items-center gap-1.5">
            <a
              href="/pricing"
              className="rounded-full px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
            >
              Pricing
            </a>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-[1500px] flex-1 items-center justify-center px-4 py-12 md:px-6">
        <div className="panel w-full max-w-md rounded-3xl px-8 py-10">
          <p className="font-[family-name:var(--font-display)] text-3xl tracking-tight">Sign in</p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Use Google to authenticate to this FileWorks URL. Conversion requires a signed-in account.
            Basic includes five conversions a day and a small AI allowance. Pro and Premium add monthly volume.
          </p>
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
              className="text-sm text-[var(--ink-muted)] transition hover:text-[var(--accent-strong)]"
            >
              Prices and roles
            </a>
          </div>
        </div>
      </main>
    </div>
  );
}
