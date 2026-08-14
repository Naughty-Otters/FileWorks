import { BrandMark } from "@/components/brand-mark";
import { LEGAL_LINKS, SITE_HOST, SUPPORT_EMAIL } from "@/lib/legal";
import { cn } from "@/lib/utils";

export function SiteFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className="relative z-10 shrink-0 border-t border-[var(--line)]">
      <div
        className={cn(
          "mx-auto flex w-full max-w-[1500px] flex-col gap-2 px-4 md:flex-row md:items-center md:justify-between md:px-6",
          compact ? "py-2.5" : "gap-3 py-6",
        )}
      >
        <p className="inline-flex items-center gap-2 text-xs text-[var(--ink-muted)]">
          <BrandMark className="h-4 w-4 text-[var(--accent)]" />
          FileWorks · {SITE_HOST} ·{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-[var(--accent-strong)]">
            {SUPPORT_EMAIL}
          </a>
        </p>
        <nav aria-label="About and legal" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-muted)]">
          {LEGAL_LINKS.map((item) => (
            <a key={item.href} href={item.href} className="hover:text-[var(--accent-strong)]">
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
