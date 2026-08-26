import { BrandLockup } from "@/components/brand-lockup";
import { ThemeToggle } from "@/components/theme-toggle";
import { SiteFooter } from "@/components/site-footer";
import { MarketingNav } from "@/components/marketing-nav";
import { BUSINESS_NAME, LEGAL_UPDATED, SITE_HOST, SITE_URL, SUPPORT_EMAIL } from "@/lib/legal";

const SECTIONS = [
  { id: "business", label: "Business and services" },
  { id: "contact", label: "Customer service" },
  { id: "returns", label: "Returns" },
  { id: "refunds", label: "Refunds and disputes" },
  { id: "cancellation", label: "Cancellation" },
  { id: "restrictions", label: "Legal and export restrictions" },
  { id: "promotions", label: "Promotions" },
] as const;

export function LegalPage() {
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
          <h1 className="font-[family-name:var(--font-display)] text-4xl tracking-tight">
            Legal, refunds, and contact
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            {BUSINESS_NAME} ({SITE_HOST}) is an online document conversion service. These policies
            apply to the website, paid subscriptions, and related billing. Last updated {LEGAL_UPDATED}.
          </p>
          <nav aria-label="On this page" className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {SECTIONS.map((item) => (
              <a key={item.id} href={`#${item.id}`} className="text-[var(--accent-strong)] hover:underline">
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        <section id="business" className="panel scroll-mt-8 rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Business and services
          </h2>
          <ul className="mt-3 space-y-1 text-sm leading-6 text-[var(--ink-muted)]">
            <li>Business name: {BUSINESS_NAME}</li>
            <li>
              Website:{" "}
              <a href={SITE_URL} className="text-[var(--accent-strong)] hover:underline">
                {SITE_URL}
              </a>
            </li>
            <li>
              Services: hosted software that converts PDF, office documents, images, scans,
              Markdown, and TXT into editable Markdown, with optional AI reading and translation.
            </li>
            <li>
              Products for sale: monthly Daily ($5) and Expert ($29) workspace subscriptions, and
              Convert API Daily ($5) and Expert ($29). Casual and API Free are free.
              See{" "}
              <a href="/about" className="text-[var(--accent-strong)] hover:underline">
                About
              </a>{" "}
              and{" "}
              <a href="/pricing" className="text-[var(--accent-strong)] hover:underline">
                Pricing
              </a>
              . We do not sell physical goods.
            </li>
          </ul>
        </section>

        <section id="contact" className="panel scroll-mt-8 rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Customer service contact details
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Email is the primary way to reach FileWorks. We use it for product questions, billing,
            refunds, and disputes.
          </p>
          <ul className="mt-3 space-y-1 text-sm leading-6 text-[var(--ink-muted)]">
            <li>
              Email:{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-[var(--accent-strong)] hover:underline">
                {SUPPORT_EMAIL}
              </a>
            </li>
            <li>
              Website:{" "}
              <a href={SITE_URL} className="text-[var(--accent-strong)] hover:underline">
                {SITE_URL}
              </a>
            </li>
            <li>
              Billing self-serve: signed-in accounts can open{" "}
              <a href="/profile" className="text-[var(--accent-strong)] hover:underline">
                Profile → Manage billing
              </a>{" "}
              for invoices, payment methods, and cancellation.
            </li>
          </ul>
        </section>

        <section id="returns" className="panel scroll-mt-8 rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Return policy and process
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            FileWorks sells digital software access and online conversion only. We do not sell
            physical goods, so there is no shipping, product return, or restocking process.
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Converted files are delivered in the workspace for download. If a conversion fails,
            retry the file or email us with the document name and the error shown.
          </p>
        </section>

        <section id="refunds" className="panel scroll-mt-8 rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Refund and dispute policy
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Workspace Daily and Expert, and Convert API Daily / Expert, are prepaid
            monthly subscriptions billed through Stripe. Casual and API Free are free. Fees pay for
            AI page allowances during that billing period. Default convert is included. The
            two products can be combined on one account and are billed separately.
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
            <li>
              We do not refund unused days, unused conversions, unused AI / translation allowance,
              or unused API credits after a paid period has started.
            </li>
            <li>
              Canceling stops the next renewal. The current period stays paid until it ends. There
              is no prorated refund.
            </li>
            <li>
              Checking out a different paid plan of the same product starts the new plan immediately
              and ends the prior subscription for that product. The other product is unchanged. We
              do not issue a prorated credit for unused time on the old plan.
            </li>
            <li>
              Duplicate or unauthorized charges: email {SUPPORT_EMAIL} with the Stripe receipt or
              the last four digits of the card and the charge date. We review those in good faith
              and refund when the charge was made in error.
            </li>
          </ul>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
            If you believe a charge is wrong, contact us before filing a card dispute so we can
            help. You may also dispute through your card issuer or Stripe. Unresolved chargebacks
            may lead to account review or suspension of paid features.
          </p>
        </section>

        <section id="cancellation" className="panel scroll-mt-8 rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Cancellation policy
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            You can cancel a paid workspace or API subscription at any time. Cancellation takes
            effect at the end of the current billing period. There is no cancellation fee. Canceling
            one product does not cancel the other.
          </p>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
            <li>Sign in and open Profile.</li>
            <li>Choose Manage billing (workspace) or Manage API billing (convert API).</li>
            <li>Cancel that subscription. Access continues until the period end date shown there.</li>
          </ol>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
            When the paid period ends, the account role returns to Casual. History already saved
            remains available; new conversions follow Casual limits. You can subscribe again from{" "}
            <a href="/pricing" className="text-[var(--accent-strong)] hover:underline">
              Pricing
            </a>
            .
          </p>
        </section>

        <section id="restrictions" className="panel scroll-mt-8 rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Legal and export restrictions
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            FileWorks is offered as an online service. By using it you agree that:
          </p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-[var(--ink-muted)]">
            <li>
              You have the right to upload and convert each file. Do not upload content you do not
              own or are not licensed to process.
            </li>
            <li>
              You will not use the service for unlawful material, malware, or content that exploits
              children.
            </li>
            <li>
              You are responsible for complying with export-control and sanctions laws that apply
              to you. We do not provide the service where Stripe cannot process payment or where
              applicable law prohibits it, including comprehensively sanctioned jurisdictions.
            </li>
            <li>
              Converted output is delivered electronically. You keep rights in your source files;
              FileWorks does not claim ownership of your documents.
            </li>
          </ul>
        </section>

        <section id="promotions" className="panel scroll-mt-8 rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
            Terms and conditions of promotions
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            FileWorks does not currently offer coupons, promotional codes, or time-limited
            discounts. Listed prices on the pricing page and at Stripe Checkout are the prices you
            pay.
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            If we run a promotion later, its terms (who is eligible, duration, and what happens
            when it ends) will be stated on the pricing page and at Checkout before you pay. Unless
            those terms say otherwise, a promotion does not change this refund or cancellation
            policy.
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
