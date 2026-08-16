import type { Metadata } from "next";
import { ConvertGuidePage } from "@/components/convert-guide-page";
import { buildPageMetadata, guideBySlug } from "@/lib/seo";

const guide = guideBySlug("word-to-markdown")!;

export const metadata: Metadata = buildPageMetadata({
  title: guide.title,
  description: guide.description,
  path: guide.path,
  keywords: [
    "Word to Markdown",
    "DOCX to Markdown",
    "DOC to Markdown",
    "convert Word to Markdown online",
    "Microsoft Word Markdown converter",
  ],
});

export default function WordToMarkdownRoute() {
  return <ConvertGuidePage guide={guide} />;
}
