import type { Metadata } from "next";
import { PricingPage } from "@/components/pricing-page";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing — Workspace and Convert API",
  description:
    "FileWorks pricing: free Basic workspace, Pro $12/mo, Premium $29/mo — includes AI reading and translation allowances. Convert API Free with 100 credits, Builder $19, Scale $49, Business $99.",
  path: "/pricing",
  keywords: [
    "PDF to Markdown pricing",
    "document converter subscription",
    "AI OCR Markdown pricing",
    "document translation subscription",
    "Markdown conversion API pricing",
    "FileWorks Pro Premium",
  ],
});

export default function PricingRoute() {
  return <PricingPage />;
}
