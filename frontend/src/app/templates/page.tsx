import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { TemplateLibrary } from "@/components/template-library";
import {
  absoluteUrl,
  breadcrumbJsonLd,
  buildPageMetadata,
  faqJsonLd,
  organizationJsonLd,
  TEMPLATE_FAQS,
  TEMPLATE_KEYWORDS,
} from "@/lib/seo";
import { PRODUCT } from "@/lib/product-copy";
import { SITE_URL } from "@/lib/legal";

export const metadata: Metadata = buildPageMetadata({
  title: "Document designs — agreements, plans, invoices & more",
  description:
    "Browse FileWorks Designs: NDAs, proposals, policies, purchase orders, checklists, offer letters, family schedules, invoices, agendas, and more. AI-fill from converted Markdown, or render starters via the API.",
  path: "/templates",
  keywords: TEMPLATE_KEYWORDS,
});

export default function TemplatesPage() {
  return (
    <>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            organizationJsonLd(),
            {
              "@type": "CollectionPage",
              "@id": `${SITE_URL}/templates`,
              url: absoluteUrl("/templates"),
              name: "FileWorks document designs",
              description:
                "Built-in fillable Designs for family schedules, business documents, and general reports.",
              isPartOf: { "@id": `${SITE_URL}/#website` },
              about: { "@id": `${SITE_URL}/#app` },
            },
            breadcrumbJsonLd([
              { name: "Home", path: "/" },
              { name: PRODUCT.designs, path: "/templates" },
            ]),
            { ...faqJsonLd(TEMPLATE_FAQS), "@id": `${SITE_URL}/templates#faq` },
          ],
        }}
      />
      <TemplateLibrary />
    </>
  );
}
