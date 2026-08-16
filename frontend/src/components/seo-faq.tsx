import type { FaqItem } from "@/lib/seo";

export function SeoFaq({
  title = "Frequently asked questions",
  items,
}: {
  title?: string;
  items: FaqItem[];
}) {
  return (
    <section className="panel rounded-3xl px-5 py-5">
      <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">{title}</h2>
      <dl className="mt-4 space-y-4">
        {items.map((item) => (
          <div key={item.question}>
            <dt className="text-sm font-medium text-[var(--ink)]">{item.question}</dt>
            <dd className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{item.answer}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
