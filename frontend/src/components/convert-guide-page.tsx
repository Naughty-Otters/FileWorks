import { BrandLockup } from "@/components/brand-lockup";
import { JsonLd } from "@/components/json-ld";
import { MarketingNav } from "@/components/marketing-nav";
import { SeoFaq } from "@/components/seo-faq";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import { guideBySlug, guideJsonLd, type ConvertGuide } from "@/lib/seo";

export function ConvertGuidePage({ guide }: { guide: ConvertGuide }) {
  const related = guide.related
    .map((slug) => guideBySlug(slug))
    .filter((item): item is ConvertGuide => Boolean(item));

  return (
    <div className="app-shell relative">
      <JsonLd data={guideJsonLd(guide)} />
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <BrandLockup />
          <MarketingNav>
            <ThemeToggle className="h-8 w-8" />
          </MarketingNav>
        </div>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 md:px-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
            Online converter
          </p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl tracking-tight">
            {guide.headline}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{guide.intro}</p>
          <p className="mt-4">
            <a
              href="/"
              className="inline-flex rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white dark:text-[#06281d]"
            >
              Open workspace and convert
            </a>
          </p>
        </div>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            What you get
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
            {guide.bullets.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            How to convert
          </h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Tips to get clean Markdown
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
            {guide.tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            How this compares to typical online converters
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{guide.comparisonIntro}</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Aspect
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    FileWorks
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    Typical free converter
                  </th>
                </tr>
              </thead>
              <tbody>
                {guide.comparisonRows.map((row) => (
                  <tr key={row.aspect} className="border-b border-[var(--line)] align-top">
                    <th scope="row" className="py-2 pr-3 font-medium text-[var(--ink)]">
                      {row.aspect}
                    </th>
                    <td className="py-2 pr-3 text-[var(--ink-muted)]">{row.fileworks}</td>
                    <td className="py-2 text-[var(--ink-muted)]">{row.typical}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Who uses this converter
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
            {guide.useCases.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Automate it with the Convert API
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Same conversion, scripted. Auth with a <code className="api-inline">fw_live_</code> API
            key from Profile; standard conversion is free up to the monthly page cap.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-2xl bg-[var(--ink)] px-4 py-3 text-xs leading-5 text-white">
            <code>{guide.apiExample}</code>
          </pre>
          <p className="mt-2 text-sm">
            <a href="/docs" className="text-[var(--accent-strong)] hover:underline">
              Full API docs — curl, Python, and JavaScript examples →
            </a>
          </p>
        </section>

        <SeoFaq items={guide.faqs} />

        {related.length ? (
          <section className="panel rounded-3xl px-5 py-5">
            <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
              Related converters
            </h2>
            <ul className="mt-3 space-y-2 text-sm">
              {related.map((item) => (
                <li key={item.slug}>
                  <a href={item.path} className="text-[var(--accent-strong)] hover:underline">
                    {item.headline}
                  </a>
                </li>
              ))}
              <li>
                <a href="/docs" className="text-[var(--accent-strong)] hover:underline">
                  Convert API docs (curl, Python, JavaScript)
                </a>
              </li>
              <li>
                <a href="/pricing" className="text-[var(--accent-strong)] hover:underline">
                  Pricing and plan limits
                </a>
              </li>
            </ul>
          </section>
        ) : null}
      </main>
      <SiteFooter />
    </div>
  );
}
