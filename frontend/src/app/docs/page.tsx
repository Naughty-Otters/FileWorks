import type { Metadata } from "next";
import { ApiPage } from "@/components/api-page";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Convert API — PDF and Office to Markdown",
  description:
    "FileWorks Convert API: upload PDF, Word, Excel, PowerPoint, or images and receive Markdown, HTML, TXT, JSON, or DOCX. curl, Python, and JavaScript examples. Free 100 page credits/month.",
  path: "/docs",
  keywords: [
    "PDF to Markdown API",
    "document conversion API",
    "DOCX to Markdown API",
    "OCR API Markdown",
    "convert PDF API",
  ],
});

export default function DocsRoute() {
  return <ApiPage />;
}
