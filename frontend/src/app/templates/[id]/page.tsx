import type { Metadata } from "next";
import { Suspense } from "react";
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
  return (
    <Suspense fallback={<p className="p-6 text-sm text-[var(--ink-muted)]">Loading design editor…</p>}>
      <TemplateEditor templateId={id} />
    </Suspense>
  );
}
