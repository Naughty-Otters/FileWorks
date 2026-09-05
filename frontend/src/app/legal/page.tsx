import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { buildPageMetadata } from "@/lib/seo";
import { BUSINESS_NAME, LEGAL_ENTITY_NAME, SITE_HOST } from "@/lib/legal";

export const metadata: Metadata = buildPageMetadata({
  title: "Legal, refunds, and contact",
  description: `${BUSINESS_NAME} (${SITE_HOST}), operated by ${LEGAL_ENTITY_NAME} — customer service, refund and dispute policy, cancellation, returns, export restrictions, and promotions.`,
  path: "/legal",
});

export default function LegalRoute() {
  return <LegalPage />;
}
