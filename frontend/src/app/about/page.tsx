import type { Metadata } from "next";
import { AboutPage } from "@/components/about-page";
import { BUSINESS_NAME, SITE_URL } from "@/lib/legal";

export const metadata: Metadata = {
  title: `About ${BUSINESS_NAME}`,
  description: `${BUSINESS_NAME} converts PDFs, office files, images, and scans to Markdown. Monthly Pro and Premium software subscriptions at ${SITE_URL}.`,
};

export default function AboutRoute() {
  return <AboutPage />;
}
