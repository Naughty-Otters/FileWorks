import type { Metadata } from "next";
import { ConvertGuidePage } from "@/components/convert-guide-page";
import { buildPageMetadata, guideBySlug } from "@/lib/seo";

const guide = guideBySlug("pdf-to-markdown")!;

export const metadata: Metadata = buildPageMetadata({
  title: guide.title,
  description: guide.description,
  path: guide.path,
  keywords: [
    "PDF to Markdown",
    "convert PDF to Markdown online",
    "PDF OCR Markdown",
    "AI PDF to Markdown",
    "translate PDF to Markdown",
    "scanned PDF to Markdown",
    "PDF to MD converter",
  ],
});

export default function PdfToMarkdownRoute() {
  return <ConvertGuidePage guide={guide} />;
}
