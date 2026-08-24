import type { DesignDocument, DesignNode } from "./types";
import { expandSampleDocument } from "./templating";

export { typeDefaultValue, effectiveDefault } from "./defaults";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function contentBounds(root: DesignNode): { w: number; h: number } {
  let maxRight = root.w;
  let maxBottom = root.h;
  const walk = (node: DesignNode, ox: number, oy: number) => {
    const left = ox + node.x;
    const top = oy + node.y;
    maxRight = Math.max(maxRight, left + node.w);
    maxBottom = Math.max(maxBottom, top + node.h);
    for (const child of node.children) walk(child, node.id === "root" ? 0 : left, node.id === "root" ? 0 : top);
  };
  for (const child of root.children) walk(child, 0, 0);
  return { w: Math.ceil(maxRight), h: Math.ceil(maxBottom) };
}

function nodeStyle(node: DesignNode): string {
  const style = node.style;
  const isRoot = node.id === "root";
  const pairs: Array<[string, string | null | undefined]> = [
    ["position", isRoot ? "relative" : "absolute"],
    ["left", isRoot ? null : `${node.x}px`],
    ["top", isRoot ? null : `${node.y}px`],
    ["width", `${node.w}px`],
    // Explicit height — `height:100%` collapses when the page only has
    // min-height, and with overflow:hidden that clips the whole document.
    ["height", `${node.h}px`],
    ["font-family", style.fontFamily],
    ["font-size", `${style.fontSize}px`],
    ["font-weight", style.bold ? "700" : null],
    ["font-style", style.italic ? "italic" : null],
    ["text-decoration", style.underline ? "underline" : null],
    ["color", style.color],
    ["background", style.backgroundColor === "transparent" ? null : style.backgroundColor],
    ["text-align", style.align],
    [
      "border",
      style.borderStyle === "none"
        ? null
        : `${style.borderWidth}px ${style.borderStyle} ${style.borderColor}`,
    ],
    ["object-fit", node.kind === "image" ? node.objectFit || "cover" : null],
    ["box-sizing", "border-box"],
    // Text must never clip mid-glyph; boxes keep hidden so nested abs
    // children don't paint outside card chrome.
    [
      "overflow",
      isRoot || node.kind === "paragraph" || node.kind === "heading" ? "visible" : "hidden",
    ],
    ["white-space", node.kind === "paragraph" || node.kind === "heading" ? "pre-wrap" : null],
    ["line-height", node.kind === "heading" ? "1.25" : node.kind === "paragraph" ? "1.4" : null],
    ["margin", node.kind === "paragraph" || node.kind === "heading" ? "0" : null],
    ["padding", node.kind === "paragraph" || node.kind === "heading" ? "4px 6px" : null],
  ];
  return pairs
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
}

function htmlNode(node: DesignNode): string {
  const attrs = `style="${escapeHtml(nodeStyle(node))}"`;
  if (node.kind === "image") {
    if (!node.imageSrc) return "";
    return `<img ${attrs} src="${escapeHtml(node.imageSrc)}" alt="${escapeHtml(node.label)}" />`;
  }
  const children = node.children.map(htmlNode).join("");
  const text =
    node.kind === "box" ? "" : escapeHtml(node.label).replace(/\n/g, "<br/>");
  const tag = node.kind === "heading" ? `h${Math.min(6, Math.max(1, node.level || 1))}` : node.kind === "paragraph" ? "p" : "div";
  return `<${tag} ${attrs}>${text}${children}</${tag}>`;
}

export type DocumentHtmlOptions = {
  /** Tight page chrome for embedding inside a scaled preview frame. */
  embed?: boolean;
};

/** Page pixel size used by the fitted Output preview. */
export function documentPageSize(doc: DesignDocument): { w: number; h: number } {
  const expanded = expandSampleDocument(doc);
  const bounds = contentBounds(expanded.root);
  return {
    w: Math.max(expanded.pageSize.w, bounds.w, expanded.root.w),
    h: Math.max(expanded.pageSize.h, bounds.h, expanded.root.h),
  };
}

/** Final printable HTML for the expanded document (defaults filled in). */
export function documentToHtml(
  doc: DesignDocument,
  title = "Document",
  options: DocumentHtmlOptions = {},
): string {
  const expanded = expandSampleDocument(doc);
  const size = documentPageSize(doc);
  // Keep root tall enough that absolutely positioned children are not clipped
  // by a shorter freeform root box.
  const root = { ...expanded.root, w: size.w, h: size.h };
  const body = htmlNode(root);
  const embed = options.embed === true;

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
html,body{margin:0;background:${embed ? "#fff" : "#e8ece9"};font-family:Arial,Helvetica,sans-serif}
.page{position:relative;overflow:visible;background:#fff;
${embed ? "margin:0;box-shadow:none;" : "margin:24px auto;box-shadow:0 12px 40px rgba(28,36,32,.12);"}
width:${size.w}px;height:${size.h}px}
@media print{html,body{background:#fff}.page{margin:0;box-shadow:none}}
</style></head><body><section class="page">${body}</section></body></html>`;
}

function mdNode(node: DesignNode, lines: string[]) {
  if (node.kind === "heading") {
    const level = Math.min(6, Math.max(1, node.level || 1));
    lines.push(`${"#".repeat(level)} ${node.label.trim()}`, "");
  } else if (node.kind === "paragraph") {
    lines.push(node.label.trim(), "");
  } else if (node.kind === "image" && node.imageSrc) {
    lines.push(`![${node.label || "image"}](${node.imageSrc})`, "");
  }
  for (const child of node.children) mdNode(child, lines);
}

/** Linear Markdown export of the expanded document. */
export function documentToMarkdown(doc: DesignDocument): string {
  const expanded = expandSampleDocument(doc);
  const lines: string[] = [];
  mdNode(expanded.root, lines);
  return lines.join("\n").trim() + "\n";
}
