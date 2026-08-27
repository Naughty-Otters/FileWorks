import type { Metadata } from "next";
import { PageEditor } from "@/components/page-editor";
import { buildPageMetadata, PRIMARY_KEYWORDS } from "@/lib/seo";
import { BUSINESS_NAME } from "@/lib/legal";
import { PRODUCT } from "@/lib/product-copy";

export const metadata: Metadata = buildPageMetadata({
  title: `${PRODUCT.editor} — edit text on a PDF or image`,
  description: `${PRODUCT.editorLine} ${BUSINESS_NAME} lets you click found text on a digital PDF for free, or find text on scans and photos with AI pages, then save the file.`,
  path: "/edit",
  keywords: [...PRIMARY_KEYWORDS, "edit PDF text online", "edit text on a PDF"],
});

export default function EditPage() {
  return <PageEditor />;
}
