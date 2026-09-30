import { BrandLockup } from "@/components/brand-lockup";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";
import { MarketingNav } from "@/components/marketing-nav";
import { SeoFaq } from "@/components/seo-faq";
import { JsonLd } from "@/components/json-ld";
import { PUBLIC_API_PLANS, PLAN_CATALOG, PRICE_ROLES } from "@/lib/plans";
import { BUSINESS_NAME, LEGAL_ENTITY_NAME, SITE_HOST, SITE_URL, SUPPORT_EMAIL } from "@/lib/legal";
import {
  CONVERT_GUIDES,
  HOME_FAQS,
  INPUT_FORMATS,
  OUTPUT_FORMATS,
  faqJsonLd,
  organizationJsonLd,
} from "@/lib/seo";

export function AboutPage() {
  return (
    <div className="app-shell relative">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            organizationJsonLd(),
            {
              "@type": "AboutPage",
              "@id": `${SITE_URL}/about`,
              url: `${SITE_URL}/about`,
              name: `About ${BUSINESS_NAME}`,
              isPartOf: { "@id": `${SITE_URL}/#website` },
              about: { "@id": `${SITE_URL}/#organization` },
            },
            { ...faqJsonLd(HOME_FAQS), "@id": `${SITE_URL}/about#faq` },
          ],
        }}
      />
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
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">{SITE_HOST}</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl tracking-tight">
            About {BUSINESS_NAME} — PDF and Office to Markdown
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            {BUSINESS_NAME} is an online document conversion service operated by{" "}
            <strong className="font-medium text-[var(--ink)]">{LEGAL_ENTITY_NAME}</strong> at{" "}
            <a href={SITE_URL} className="text-[var(--accent-strong)] hover:underline">
              {SITE_URL}
            </a>
            . We turn PDF, Microsoft Office, images, and scans into editable Markdown for writing,
            coding agents, Obsidian vaults, and RAG pipelines — with optional AI reading (OCR),
            translation into 19 languages, and fillable Designs (family schedules, invoices,
            agendas, and more) — then sell monthly software subscriptions for that workspace and
            Convert API. We do not sell physical goods.
          </p>
        </div>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Company
          </h2>
          <ul className="mt-3 space-y-1 text-sm leading-6 text-[var(--ink-muted)]">
            <li>
              Legal entity: <span className="text-[var(--ink)]">{LEGAL_ENTITY_NAME}</span>
            </li>
            <li>
              Product / brand: <span className="text-[var(--ink)]">{BUSINESS_NAME}</span>
            </li>
            <li>
              Website:{" "}
              <a href={SITE_URL} className="text-[var(--accent-strong)] hover:underline">
                {SITE_URL}
              </a>
            </li>
            <li>
              Contact:{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[var(--accent-strong)] hover:underline">
                {SUPPORT_EMAIL}
              </a>
            </li>
          </ul>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
            {LEGAL_ENTITY_NAME} builds and operates {BUSINESS_NAME} at {SITE_HOST}. The product name
            and domain are branding for the same company.
          </p>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Goods and services
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Customers upload files in the {BUSINESS_NAME} workspace. We convert PDF, Microsoft
            Office (Word, Excel, PowerPoint), OpenDocument, CSV, images, scans, Markdown, and TXT
            into editable Markdown. Optional add-ons in the same pass: AI reading of scans and
            images, and translation into 19 languages. Results download as Markdown, TXT, HTML,
            JSON, Word (.docx), or print-ready PDF. Signed-in users can also apply fillable Designs —
            family planners, business documents, and custom layouts — and fill them from extracted
            Markdown or Design starter API variable params.
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            What we charge for: workspace AI page allowances (Daily and Expert) and
            Convert API AI page credits and keys. Default convert is included. Editor
            edits text on PDFs and images; finding text on scans uses the same AI page
            allowance. Each paid product is a monthly software subscription through Stripe.
            The two products can be held together.
          </p>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Supported formats
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Inputs (up to 50 MB): {INPUT_FORMATS.join("; ")}.
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Outputs: {OUTPUT_FORMATS.join(", ")}.
          </p>
          <ul className="mt-4 space-y-1 text-sm">
            {CONVERT_GUIDES.map((guide) => (
              <li key={guide.slug}>
                <a href={guide.path} className="text-[var(--accent-strong)] hover:underline">
                  {guide.headline}
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Who it is for
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
            <li>
              Developers and AI agents that need PDF or Office content as clean Markdown before
              summarization, coding, or RAG chunking.
            </li>
            <li>
              Writers and researchers moving reports, papers, and slide decks into Obsidian,
              Notion-export Markdown, or Git-backed docs.
            </li>
            <li>
              Teams that need OCR on scans plus optional translation without juggling separate
              tools.
            </li>
          </ul>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Products we sell
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Two products. Workspace: Guest, Casual, Daily, Expert. Convert API: Free, Daily,
            Expert. Paid grades are billed monthly through Stripe. Guest can browse the site but
            cannot convert files in the app.
          </p>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left text-sm">
              <caption className="sr-only">{BUSINESS_NAME} products and prices</caption>
              <thead>
                <tr className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                  <th className="pb-2 pr-3 font-medium">Product</th>
                  <th className="pb-2 pr-3 font-medium">Price</th>
                  <th className="pb-2 font-medium">What you get</th>
                </tr>
              </thead>
              <tbody>
                {PRICE_ROLES.map((item) => (
                  <tr key={item.id} className="border-t border-[var(--line)]">
                    <td className="py-2.5 pr-3 font-medium">{item.role}</td>
                    <td className="py-2.5 pr-3 text-[var(--ink-muted)]">{item.price}</td>
                    <td className="py-2.5 text-[var(--ink-muted)]">{item.blurb}</td>
                  </tr>
                ))}
                {PUBLIC_API_PLANS.map((item) => (
                  <tr key={item.id} className="border-t border-[var(--line)]">
                    <td className="py-2.5 pr-3 font-medium">{item.label}</td>
                    <td className="py-2.5 pr-3 text-[var(--ink-muted)]">{item.price}</td>
                    <td className="py-2.5 text-[var(--ink-muted)]">{item.blurb}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-4 space-y-1 text-sm leading-6 text-[var(--ink-muted)]">
            {PLAN_CATALOG.map((plan) => (
              <li key={plan.id}>
                <span className="font-medium text-[var(--ink)]">{plan.label}</span>
                {" — "}
                {plan.price}. {plan.quota}. {plan.features[1] || plan.features[0]}
              </li>
            ))}
            {PUBLIC_API_PLANS.map((plan) => (
              <li key={plan.id}>
                <span className="font-medium text-[var(--ink)]">{plan.label}</span>
                {" — "}
                {plan.price}. {plan.quota}. {plan.features[0]}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm">
            <a href="/pricing" className="text-[var(--accent-strong)] hover:underline">
              Open full pricing and subscribe
            </a>
          </p>
        </section>

        <SeoFaq title="Common questions" items={HOME_FAQS} />

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Customer service
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[var(--accent-strong)] hover:underline">
              {SUPPORT_EMAIL}
            </a>
            . This page,{" "}
            <a href="/pricing" className="text-[var(--accent-strong)] hover:underline">
              Pricing
            </a>
            ,{" "}
            <a href="/docs" className="text-[var(--accent-strong)] hover:underline">
              API
            </a>
            , and{" "}
            <a href="/legal" className="text-[var(--accent-strong)] hover:underline">
              Legal
            </a>{" "}
            are public and do not require an account.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
