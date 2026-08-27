import { markdownToHtml } from "@/lib/markdown-runtime";
import { previewHtmlToMarkdown } from "@/lib/html-to-markdown";

/** Markdown → TipTap/HTML content. */
export async function docsLiteMarkdownToHtml(markdown: string): Promise<string> {
  if (!markdown.trim()) return "<p></p>";
  const html = await markdownToHtml(markdown);
  return html.trim() || "<p></p>";
}

/**
 * Remark wraps GFM tables in <div class="prose-table-wrap"> for the result panel.
 * TipTap's table schema wants a bare <table> — unwrap before setContent.
 */
export function prepareHtmlForTipTap(html: string): string {
  return html.replace(
    /<div[^>]*class="[^"]*prose-table-wrap[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    "$1",
  );
}

/** Escape + paragraph-split so content always shows if rich HTML parse fails. */
export function docsLitePlainFallbackHtml(markdown: string): string {
  if (!markdown.trim()) return "<p></p>";
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<p>${escaped.split(/\n\n+/).join("</p><p>").replace(/\n/g, "<br>")}</p>`;
}

/** TipTap HTML → plain text (for non-Markdown files). */
export function docsLiteHtmlToPlain(html: string): string {
  if (typeof document === "undefined") {
    return html
      .replace(/<\/(p|div|h[1-6]|li|tr|br)\b[^>]*>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&nbsp;/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
  }
  const root = document.createElement("div");
  root.innerHTML = html;
  const blocks: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? "";
      if (t) blocks.push(t);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      blocks.push("\n");
      return;
    }
    const isBlock = /^(p|div|h[1-6]|li|tr|pre|blockquote|hr)$/.test(tag);
    if (isBlock && blocks.length && !blocks[blocks.length - 1]!.endsWith("\n")) {
      blocks.push("\n");
    }
    node.childNodes.forEach(walk);
    if (isBlock) blocks.push("\n");
  };
  root.childNodes.forEach(walk);
  return blocks.join("").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
}

/** TipTap HTML → Markdown for save. */
export function docsLiteHtmlToMarkdown(html: string): string {
  return previewHtmlToMarkdown(html);
}

/** Stable-ish round-trip for common structures (used in tests). */
export async function docsLiteRoundTrip(markdown: string): Promise<string> {
  const html = prepareHtmlForTipTap(await docsLiteMarkdownToHtml(markdown));
  return docsLiteHtmlToMarkdown(html);
}
