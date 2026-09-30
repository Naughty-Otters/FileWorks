import { SeoFaq } from "@/components/seo-faq";
import { SiteFooter } from "@/components/site-footer";
import { BUSINESS_NAME } from "@/lib/legal";
import { CONVERT_GUIDES, HOME_FAQS, SITE_DESCRIPTION } from "@/lib/seo";

/**
 * Real, crawlable marketing copy for "/". The interactive Workspace above this
 * is a fixed-height client app shell — search engines need this in normal
 * document flow underneath it, not hidden inside that shell.
 */
export function HomeSeoContent() {
  return (
    <>
      <main className="relative z-10 mx-auto w-full max-w-3xl flex-1 px-4 py-10 md:px-6">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-tight">
            Convert PDF, Word, Excel & PowerPoint to Markdown
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{SITE_DESCRIPTION}</p>
        </div>

        <section className="panel mt-8 rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Converters by file type
          </h2>
          <ul className="mt-3 grid gap-4 sm:grid-cols-2">
            {CONVERT_GUIDES.map((guide) => (
              <li key={guide.slug}>
                <a href={guide.path} className="text-sm font-medium text-[var(--accent-strong)] hover:underline">
                  {guide.headline}
                </a>
                <p className="mt-1 text-sm leading-6 text-[var(--ink-muted)]">{guide.description}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel mt-8 rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Why {BUSINESS_NAME}
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
            <li>AI reading (OCR) for scanned PDFs, photos, and image-only pages</li>
            <li>Translate documents into 19 languages in the same conversion pass</li>
            <li>Edit text directly on the page, or fill a Design (invoice, schedule, agenda, and more) from the result</li>
            <li>Convert API with long-lived keys for scripts, agents, and RAG pipelines</li>
          </ul>
        </section>

        <div className="mt-8">
          <SeoFaq title="Common questions" items={HOME_FAQS} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
