import { BrandMark } from "@/components/brand-mark";
import { BUSINESS_NAME } from "@/lib/legal";
import { cn } from "@/lib/utils";

export function BrandLockup({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <a
      href={href}
      aria-label={BUSINESS_NAME}
      className={cn("inline-flex items-center gap-2 text-[var(--ink)] no-underline", className)}
    >
      <BrandMark className="h-7 w-7 shrink-0 text-[var(--accent)] md:h-8 md:w-8" />
      <span className="font-[family-name:var(--font-display)] text-xl tracking-tight md:text-2xl">
        {BUSINESS_NAME}
      </span>
    </a>
  );
}
