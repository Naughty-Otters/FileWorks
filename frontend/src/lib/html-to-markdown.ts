import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
});
turndown.use(gfm);
turndown.addRule("keepDataImages", {
  filter: (node) =>
    node.nodeName === "IMG" &&
    typeof (node as HTMLImageElement).getAttribute("src") === "string" &&
    Boolean((node as HTMLImageElement).getAttribute("src")?.startsWith("data:")),
  replacement: (_content, node) => {
    const img = node as HTMLImageElement;
    const src = img.getAttribute("src") || "";
    const alt = img.getAttribute("alt") || "";
    const cls = img.getAttribute("class") || "";
    const style = img.getAttribute("style") || "";
    const width =
      /(?:^|;)\s*width:\s*(\d+)px/i.exec(style)?.[1] || img.getAttribute("width") || "";
    const align = /\bfw-img-right\b/.test(cls) ? "right" : /\bfw-img-left\b/.test(cls) ? "left" : "";
    const title = [width, align].filter(Boolean).join(" ");
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  },
});
turndown.addRule("mathDisplay", {
  filter: (node) => {
    if (!(node instanceof HTMLElement)) return false;
    return node.classList.contains("math-display") || node.classList.contains("katex-display");
  },
  replacement: (_content, node) => {
    const latex = mathLatex(node as HTMLElement);
    return latex ? `\n\n$$\n${latex}\n$$\n\n` : "";
  },
});
turndown.addRule("mathInline", {
  filter: (node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.classList.contains("math-display") || node.classList.contains("katex-display")) return false;
    if (node.closest(".math-display, .katex-display") && !node.classList.contains("math-inline")) {
      return false;
    }
    return node.classList.contains("math-inline") || node.classList.contains("katex");
  },
  replacement: (_content, node) => {
    const latex = mathLatex(node as HTMLElement);
    return latex ? `$${latex}$` : "";
  },
});

function mathLatex(node: HTMLElement): string {
  const fromAttr = node.getAttribute("data-latex")?.trim();
  if (fromAttr) return fromAttr;
  return node.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() || "";
}

/** Preview HTML (including KaTeX) → Markdown source. */
export function previewHtmlToMarkdown(html: string): string {
  return turndown.turndown(html).replace(/\n{3,}/g, "\n\n").trimEnd();
}
