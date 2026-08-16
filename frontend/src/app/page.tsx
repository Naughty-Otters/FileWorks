import type { Metadata } from "next";
import { JsonLd } from "@/components/json-ld";
import { Workspace } from "@/components/workspace";
import { buildPageMetadata, homeJsonLdGraph, SITE_DESCRIPTION, SITE_TAGLINE } from "@/lib/seo";
import { BUSINESS_NAME } from "@/lib/legal";

export const metadata: Metadata = buildPageMetadata({
  title: `${BUSINESS_NAME} — ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
  path: "/",
});

export default function Home() {
  return (
    <>
      <JsonLd data={homeJsonLdGraph()} />
      <Workspace />
    </>
  );
}
