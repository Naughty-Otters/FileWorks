import type { Metadata } from "next";
import { ConvertGuidePage } from "@/components/convert-guide-page";
import { buildPageMetadata, guideBySlug } from "@/lib/seo";

const guide = guideBySlug("epub-to-markdown")!;

export const metadata: Metadata = buildPageMetadata({
  title: guide.title,
  description: guide.description,
  path: guide.path,
  keywords: [
    "EPUB to Markdown",
    "convert EPUB to Markdown online",
    "EPUB to Markdown converter",
    "ebook to Markdown",
    "translate EPUB to Markdown",
  ],
});

export default function EpubToMarkdownRoute() {
  return <ConvertGuidePage guide={guide} />;
}
