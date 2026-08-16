import type { Metadata } from "next";
import { ConvertGuidePage } from "@/components/convert-guide-page";
import { buildPageMetadata, guideBySlug } from "@/lib/seo";

const guide = guideBySlug("excel-to-markdown")!;

export const metadata: Metadata = buildPageMetadata({
  title: guide.title,
  description: guide.description,
  path: guide.path,
  keywords: [
    "Excel to Markdown",
    "XLSX to Markdown",
    "CSV to Markdown",
    "spreadsheet to Markdown",
    "Excel Markdown table converter",
  ],
});

export default function ExcelToMarkdownRoute() {
  return <ConvertGuidePage guide={guide} />;
}
