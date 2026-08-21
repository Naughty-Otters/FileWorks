import type { Metadata } from "next";
import { ApiPage } from "@/components/api-page";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Convert API — PDF and Office to Markdown & Designs",
  description:
    "FileWorks Convert API: upload PDF, Word, Excel, PowerPoint, or images and receive Markdown, HTML, TXT, JSON, or DOCX. Optional design= fills a starter Design (invoice, schedules, agendas) from extracted Markdown. curl, Python, and JavaScript examples.",
  path: "/docs",
  keywords: [
    "PDF to Markdown API",
    "document conversion API",
    "DOCX to Markdown API",
    "OCR API Markdown",
    "document translation API",
    "AI document conversion API",
    "convert PDF API",
    "document design from PDF API",
    "fillable design convert API",
  ],
});

export default function DocsRoute() {
  return <ApiPage />;
}
