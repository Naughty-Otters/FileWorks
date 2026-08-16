import type { Metadata } from "next";
import { PricingPage } from "@/components/pricing-page";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing — Workspace and Convert API",
  description:
    "FileWorks pricing: free Basic workspace, Pro $12/mo, Premium $29/mo. Convert API Free with 100 credits, Builder $19, Scale $49, Business $99. PDF and Office to Markdown plans.",
  path: "/pricing",
  keywords: [
    "PDF to Markdown pricing",
    "document converter subscription",
    "Markdown conversion API pricing",
    "FileWorks Pro Premium",
  ],
});

export default function PricingRoute() {
  return <PricingPage />;
}
