import type { Metadata } from "next";
import { TemplateEditor } from "@/components/template-editor";

export const metadata: Metadata = {
  title: "Template Editor · FileWorks",
};

export default async function TemplateEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TemplateEditor templateId={id} />;
}
