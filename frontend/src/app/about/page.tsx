import type { Metadata } from "next";
import { AboutPage } from "@/components/about-page";
import { buildPageMetadata } from "@/lib/seo";
import { BUSINESS_NAME, LEGAL_ENTITY_NAME } from "@/lib/legal";

export const metadata: Metadata = buildPageMetadata({
  title: `About ${BUSINESS_NAME}`,
  description: `${BUSINESS_NAME} is operated by ${LEGAL_ENTITY_NAME}. Convert PDF, Word, Excel, PowerPoint, images, and scans into editable Markdown with optional AI OCR and translation. Monthly workspace and Convert API subscriptions at fileworks.ai.`,
  path: "/about",
});

export default function AboutRoute() {
  return <AboutPage />;
}
