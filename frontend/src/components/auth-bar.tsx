"use client";

import type { MeResponse } from "@/lib/api";

type AuthBarProps = {
  me: MeResponse | null;
  loginHref?: string;
};

function accountTitle(me: MeResponse): string {
  const who = me.user?.name || me.user?.email || "Signed in";
  const quota =
    me.quota.limit_day != null
      ? `${me.quota.used_day}/${me.quota.limit_day} today`
      : me.quota.limit_month != null
        ? `${me.quota.used_month}/${me.quota.limit_month} this month`
        : null;
  return [who, me.plan, quota].filter(Boolean).join(" · ");
}

function initials(me: MeResponse): string {
  const source = me.user?.name || me.user?.email || "?";
  return source.slice(0, 1).toUpperCase();
}

export function AuthBar({ me, loginHref = "/login" }: AuthBarProps) {
  if (me?.user) {
    const title = accountTitle(me);
    if (me.user.picture_url) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <a href="/profile" aria-label="Account">
          <img src={me.user.picture_url} alt="" title={title} className="h-8 w-8 rounded-full" />
        </a>
      );
    }
    return (
      <a
        href="/profile"
        aria-label="Account"
        title={title}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-xs font-medium text-[var(--accent-strong)]"
      >
        {initials(me)}
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
