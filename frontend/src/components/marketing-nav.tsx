import { MARKETING_LINKS } from "@/lib/legal";
import type { ReactNode } from "react";

const linkClass =
  "rounded-full px-2.5 py-1 text-xs font-medium text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]";

export function MarketingNav({ children }: { children?: ReactNode }) {
  return (
    <div className="ml-auto flex items-center gap-1.5">
      {MARKETING_LINKS.map((item) => (
        <a key={item.href} href={item.href} className={linkClass}>
          {item.label}
        </a>
      ))}
      {children}
    </div>
  );
}
