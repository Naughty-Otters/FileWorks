import type { Metadata } from "next";
import { ConvertGuidePage } from "@/components/convert-guide-page";
import { buildPageMetadata, guideBySlug } from "@/lib/seo";

const guide = guideBySlug("csv-to-markdown")!;

export const metadata: Metadata = buildPageMetadata({
  title: guide.title,
  description: guide.description,
  path: guide.path,
  keywords: [
    "CSV to Markdown",
    "convert CSV to Markdown online",
    "CSV to Markdown table converter",
    "CSV to MD converter",
    "translate CSV to Markdown",
  ],
});

export default function CsvToMarkdownRoute() {
  return <ConvertGuidePage guide={guide} />;
}
