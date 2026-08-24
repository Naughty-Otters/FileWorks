import type { Metadata } from "next";
import { TemplateEditor } from "@/components/template-editor";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Design editor",
  description: "Edit a saved FileWorks Design. Sign in required.",
  path: "/templates",
  noIndex: true,
});

/** Static export requires params; other ids are served via Pages `_redirects`. */
export function generateStaticParams() {
  return [{ id: "new" }];
}

export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateEditor templateId={id} />;
}
