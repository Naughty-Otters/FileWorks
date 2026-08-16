import { BrandLockup } from "@/components/brand-lockup";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";
import { MarketingNav } from "@/components/marketing-nav";
import { API_PLAN_CATALOG, PLAN_CATALOG, PRICE_ROLES } from "@/lib/plans";
import { BUSINESS_NAME, SITE_HOST, SITE_URL, SUPPORT_EMAIL } from "@/lib/legal";

export function AboutPage() {
  return (
    <div className="app-shell relative">
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
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl tracking-tight">{BUSINESS_NAME}</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            {BUSINESS_NAME} is an online software service at{" "}
            <a href={SITE_URL} className="text-[var(--accent-strong)] hover:underline">
              {SITE_URL}
            </a>
            . We convert documents into editable Markdown and sell monthly subscriptions for that
            software. We do not sell physical goods.
          </p>
        </div>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Goods and services
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Customers upload files in the {BUSINESS_NAME} workspace. We convert PDF, Microsoft
            Office (Word, Excel, PowerPoint), OpenDocument, CSV, images, scans, Markdown, and TXT
            into editable Markdown. Optional add-ons in the same pass: AI reading of scans and
            images, and translation into 19 languages. Results download as Markdown, TXT, HTML,
            JSON, or print-ready PDF.
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            What we charge for: workspace access (file quotas and AI / translation allowances) and
            Convert API access (page credits and API keys), each billed as a monthly software
            subscription through Stripe. The two products can be held together.
          </p>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Products we sell
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Two products. Workspace: Guest, Basic, Pro, Premium. Convert API: Free, Builder, Scale,
            Business. Paid grades are billed monthly through Stripe. Guest can browse the site but
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
                {API_PLAN_CATALOG.map((item) => (
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
            {API_PLAN_CATALOG.map((plan) => (
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
