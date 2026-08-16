import type { Metadata } from "next";
import { ConvertGuidePage } from "@/components/convert-guide-page";
import { buildPageMetadata, guideBySlug } from "@/lib/seo";

const guide = guideBySlug("image-to-markdown")!;

export const metadata: Metadata = buildPageMetadata({
  title: guide.title,
  description: guide.description,
  path: guide.path,
  keywords: [
    "image to Markdown",
    "OCR to Markdown",
    "scan to Markdown",
    "photo OCR Markdown",
    "TIFF to Markdown",
  ],
});

export default function ImageToMarkdownRoute() {
  return <ConvertGuidePage guide={guide} />;
}
