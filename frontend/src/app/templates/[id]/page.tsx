import type { Metadata } from "next";
import { TemplateEditor } from "@/components/template-editor";
import { buildPageMetadata } from "@/lib/seo";

export const metadata: Metadata = buildPageMetadata({
  title: "Design editor",
  description: "Edit a saved FileWorks Design. Sign in required.",
  path: "/templates",
  noIndex: true,
});

export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateEditor templateId={id} />;
}
