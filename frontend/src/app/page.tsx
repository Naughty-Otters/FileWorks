import type { Metadata } from "next";
import { HomeSeoContent } from "@/components/home-seo-content";
import { JsonLd } from "@/components/json-ld";
import { Workspace } from "@/components/workspace";
import { buildPageMetadata, homeJsonLdGraph, SITE_DESCRIPTION } from "@/lib/seo";
import { BUSINESS_NAME } from "@/lib/legal";

export const metadata: Metadata = buildPageMetadata({
  // Leads with the head term ("Markdown") competitors already rank for —
  // the tagline used in-app doesn't mention it at all.
  title: `${BUSINESS_NAME} — Convert PDF, Word, Excel & PowerPoint to Markdown`,
  description: SITE_DESCRIPTION,
  path: "/",
});

export default function Home() {
  return (
    <>
      <JsonLd data={homeJsonLdGraph()} />
      <Workspace />
      <HomeSeoContent />
    </>
  );
}
