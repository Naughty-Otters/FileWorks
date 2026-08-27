import type { Metadata } from "next";
import { PricingPage } from "@/components/pricing-page";
import { pricingPageDescription } from "@/lib/plan-quotas";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing — Workspace and Convert API",
  description: pricingPageDescription(),
  path: "/pricing",
  keywords: [
    "PDF to Markdown pricing",
    "document converter subscription",
    "AI OCR Markdown pricing",
    "document translation subscription",
    "Markdown conversion API pricing",
    "FileWorks Daily Expert",
  ],
});

export default function PricingRoute() {
  return <PricingPage />;
}
