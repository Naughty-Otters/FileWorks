"use client";

import type { ReactNode } from "react";
import { AuthBar } from "@/components/auth-bar";
import { BrandLockup } from "@/components/brand-lockup";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import { useSession } from "@/lib/session";

export function TemplateShell({ children, fixed = false }: { children: ReactNode; fixed?: boolean }) {
  const { me, status, displayUser } = useSession();
  return (
    <div className={`app-shell relative ${fixed ? "app-shell-fixed" : ""}`}>
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 shrink-0 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <BrandLockup />
          <a href="/templates" className="ml-auto rounded-full px-2.5 py-1.5 text-xs text-[var(--accent-strong)] transition hover:bg-[var(--accent-soft)]">
            Templates
          </a>
          <a href="/pricing" className="rounded-full px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]">
            Pricing
          </a>
          <AuthBar me={me} status={status} user={displayUser} />
          <ThemeToggle className="h-8 w-8" />
        </div>
      </header>
      {children}
      <SiteFooter compact />
    </div>
  );
}
