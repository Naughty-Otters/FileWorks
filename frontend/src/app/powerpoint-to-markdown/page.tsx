import type { Metadata } from "next";
import { ConvertGuidePage } from "@/components/convert-guide-page";
import { buildPageMetadata, guideBySlug } from "@/lib/seo";

const guide = guideBySlug("powerpoint-to-markdown")!;

export const metadata: Metadata = buildPageMetadata({
  title: guide.title,
  description: guide.description,
  path: guide.path,
  keywords: [
    "PowerPoint to Markdown",
    "PPTX to Markdown",
    "PPT to Markdown",
    "AI PowerPoint to Markdown",
    "translate PowerPoint to Markdown",
    "convert PowerPoint to Markdown",
    "slides to Markdown",
  ],
});

export default function PowerpointToMarkdownRoute() {
  return <ConvertGuidePage guide={guide} />;
}
