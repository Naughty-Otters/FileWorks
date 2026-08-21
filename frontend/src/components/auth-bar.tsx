"use client";

import type { MeResponse, SessionUser } from "@/lib/auth";
import type { SessionStatus } from "@/lib/session";

type AuthBarProps = {
  me: MeResponse | null;
  status?: SessionStatus;
  user?: SessionUser | null;
  loginHref?: string;
};

function accountTitle(user: SessionUser, me: MeResponse | null): string {
  const who = user.name || user.email || "Signed in";
  const quota =
    me == null
      ? null
      : me.quota.limit_day != null
        ? `${me.quota.used_day}/${me.quota.limit_day} today`
        : me.quota.limit_month != null
          ? `${me.quota.used_month}/${me.quota.limit_month} this month`
          : null;
  return [who, me?.plan ?? user.plan, quota].filter(Boolean).join(" · ");
}

function initials(user: SessionUser): string {
  const source = user.name || user.email || "?";
  return source.slice(0, 1).toUpperCase();
}

const avatarClass =
  "relative inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-[var(--accent-soft)] text-xs font-medium text-[var(--accent-strong)]";

export function AuthBar({ me, status, user, loginHref = "/login" }: AuthBarProps) {
  const account = user ?? me?.user ?? null;
  const resolved: SessionStatus = status ?? (me ? (me.user ? "signed-in" : "guest") : "unknown");
  // Unknown without a cached identity is a new visitor — show Sign in, not a
  // loading stand-in. Returning users hydrate as signed-in with a hint.
  const signedIn = resolved === "signed-in" || Boolean(account);

  if (signedIn) {
    const title = account ? accountTitle(account, me) : "Account";
    return (
      <a href="/profile" aria-label="Account" title={title} className={avatarClass}>
        {account ? initials(account) : null}
        {account?.picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.picture_url}
            alt=""
            className="absolute inset-0 h-full w-full rounded-full object-cover"
          />
        ) : null}
      </a>
    );
  }

  return (
    <a
      href={loginHref}
      className="rounded-full px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
    >
      Sign in
    </a>
  );
}
