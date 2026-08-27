import type { Metadata } from "next";
import { EditorShell } from "@/components/editor-shell";
import { buildPageMetadata, PRIMARY_KEYWORDS } from "@/lib/seo";
import { BUSINESS_NAME } from "@/lib/legal";
import { PRODUCT } from "@/lib/product-copy";

export const metadata: Metadata = buildPageMetadata({
  title: `${PRODUCT.editor} — PDF, image, text, or Word`,
  description: `${PRODUCT.editorLine} ${BUSINESS_NAME} stamps text on PDFs and images, opens text in TipTap, and opens Word (.docx) in the browser without a server convert. Excel/PowerPoint still convert once.`,
  path: "/edit",
  keywords: [
    ...PRIMARY_KEYWORDS,
    "edit PDF text online",
    "edit text on a PDF",
    "edit Markdown online",
    "edit Word online",
    "Markdown document editor",
  ],
});

export default function EditPage() {
  return <EditorShell />;
}
