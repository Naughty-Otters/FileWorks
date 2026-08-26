import type { Metadata } from "next";
import { PricingPage } from "@/components/pricing-page";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Pricing — Workspace and Convert API",
  description:
    "FileWorks pricing: free Casual workspace (30 conversions/day), Daily $5/mo, Expert $29/mo. Convert is free; pay for AI pages. Convert API Free, Daily $5, Expert $29.",
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
