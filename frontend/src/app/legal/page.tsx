import type { Metadata } from "next";
import { LegalPage } from "@/components/legal-page";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Legal, refunds, and contact",
  description:
    "FileWorks (fileworks.ai) customer service, refund and dispute policy, cancellation, returns, export restrictions, and promotions for document conversion subscriptions.",
  path: "/legal",
});

export default function LegalRoute() {
  return <LegalPage />;
}
