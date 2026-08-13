"use client";

import { useEffect, useRef } from "react";
import { LogOut } from "lucide-react";
import { fetchMe, loginWithGoogle, logoutSession, type MeResponse } from "@/lib/api";

type AuthBarProps = {
  me: MeResponse | null;
  onChange: (me: MeResponse | null) => void;
};

export function AuthBar({ me, onChange }: AuthBarProps) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const clientId = me?.google_client_id || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

  useEffect(() => {
    if (me?.user || !clientId || !buttonRef.current) return;
    const w = window as Window & {
      google?: {
        accounts: {
          id: {
            initialize: (opts: object) => void;
            renderButton: (el: HTMLElement, opts: object) => void;
          };
        };
      };
    };
    function render() {
      if (!w.google || !buttonRef.current) return;
      w.google.accounts.id.initialize({
        client_id: clientId,
        callback: async (resp: { credential: string }) => {
          const next = await loginWithGoogle(resp.credential);
          onChange(next);
        },
      });
      w.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "medium",
        type: "standard",
      });
    }
    if (w.google) {
      render();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [clientId, me?.user, onChange]);

  if (me?.user) {
    return (
      <div className="flex items-center gap-2">
        {me.user.picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.user.picture_url} alt="" className="h-7 w-7 rounded-full" />
        ) : null}
        <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent-strong)]">
          {me.plan}
        </span>
        {me.quota.limit_day != null ? (
          <span
            className="hidden text-[11px] text-[var(--ink-muted)] sm:inline"
            title={`${me.quota.used_day}/${me.quota.limit_day} conversions today`}
          >
            {me.quota.used_day}/{me.quota.limit_day} today
          </span>
        ) : me.quota.limit_month != null ? (
          <span
            className="hidden text-[11px] text-[var(--ink-muted)] sm:inline"
            title={`${me.quota.used_month}/${me.quota.limit_month} conversions this month`}
          >
            {me.quota.used_month}/{me.quota.limit_month} this month
          </span>
        ) : null}
        <span className="hidden max-w-[10rem] truncate text-xs text-[var(--ink-muted)] md:inline">
          {me.user.name || me.user.email}
        </span>
        <button
          type="button"
          aria-label="Sign out"
          onClick={async () => {
            await logoutSession();
            const guest = await fetchMe().catch(() => null);
            onChange(guest);
          }}
          className="rounded-full p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
        >
          <LogOut size={14} />
        </button>
      </div>
    );
  }

  if (!clientId) {
    return <span className="text-xs text-[var(--ink-muted)]">Set GOOGLE_CLIENT_ID to enable sign-in</span>;
  }

  return <div ref={buttonRef} />;
}
