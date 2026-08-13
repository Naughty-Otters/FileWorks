import { renderMarkdownToHtml } from "@/lib/markdown-to-html";

/** Markdown → sanitized HTML. Runs async on the main thread (innerHTML, not a React tree). */
export function markdownToHtml(markdown: string): Promise<string> {
  return renderMarkdownToHtml(markdown);
}

export function prefetchMarkdownRuntime() {
  return import("@/lib/markdown-to-html");
}
