import { expandMarkdownLayoutDirectivesAsync } from "@/lib/markdown-layout";
import katex, { type KatexOptions } from "katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { SKIP, visit } from "unist-util-visit";
import type { Element, ElementContent, Root } from "hast";

const katexOptions: KatexOptions = {
  throwOnError: false,
  strict: "ignore",
  output: "html",
  trust: false,
};

export const markdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || ["http", "https"]), "data", "blob"],
  },
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "mark",
    "u",
    "sub",
    "sup",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "colgroup",
    "col",
    "span",
    "div",
    "section",
    "figure",
    "figcaption",
    "svg",
    "path",
    "line",
    "g",
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": [
      "className",
      "class",
      "style",
      "id",
      "align",
      "colspan",
      "rowspan",
      "width",
      "height",
      "ariaHidden",
      "dataLatex",
    ],
    td: [...(defaultSchema.attributes?.td || []), "colspan", "rowspan", "align", "style"],
    th: [...(defaultSchema.attributes?.th || []), "colspan", "rowspan", "align", "style"],
    table: [...(defaultSchema.attributes?.table || []), "border", "style", "width"],
    span: ["style", "className", "class", "dataLatex"],
    div: ["style", "className", "class", "align", "dataLatex"],
    img: [...(defaultSchema.attributes?.img || []), "src", "alt", "title", "width", "height", "style", "className", "class"],
    svg: ["viewBox", "preserveAspectRatio", "ariaHidden", "focusable", "role", "xmlns", "style", "className", "class", "width", "height"],
    path: ["d", "transform", "fill", "stroke", "style", "className", "class"],
    line: ["x1", "y1", "x2", "y2", "strokeWidth", "stroke", "style"],
  },
};

function classNames(node: Element): string[] {
  const value = node.properties?.className;
  if (Array.isArray(value)) return value.map(String);
  return [];
}

function elementText(node: Element): string {
  let text = "";
  for (const child of node.children) {
    if (child.type === "text") text += child.value;
    else if (child.type === "element") text += elementText(child);
  }
  return text;
}

function firstCodeChild(node: Element): Element | null {
  for (const child of node.children) {
    if (child.type === "element" && child.tagName === "code") return child;
  }
  return null;
}

function mathKind(node: Element): "inline" | "display" | null {
  const classes = classNames(node);
  if (classes.includes("math-display")) return "display";
  if (classes.includes("math-inline")) return "inline";
  if (classes.includes("language-math")) return "inline";
  return null;
}

function renderMathHtml(latex: string, display: boolean): string {
  try {
    return katex.renderToString(latex, { ...katexOptions, displayMode: display });
  } catch {
    const safe = latex.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<span class="katex-error">${safe}</span>`;
  }
}

function mathElement(latex: string, display: boolean): Element {
  const html = renderMathHtml(latex, display);
  return {
    type: "element",
    tagName: display ? "div" : "span",
    properties: {
      className: display ? ["math-display"] : ["math-inline"],
      dataLatex: latex,
    },
    children: [{ type: "raw", value: html } as unknown as ElementContent],
  };
}

function isMathOnlyParagraph(node: Element): Element | null {
  if (node.tagName !== "p") return null;
  const meaningful = node.children.filter((child) => {
    if (child.type === "text") return Boolean(child.value.trim());
    return child.type === "element";
  });
  if (meaningful.length !== 1 || meaningful[0].type !== "element") return null;
  return mathKind(meaningful[0]) ? meaningful[0] : null;
}

/** Turn remark-math / ```math nodes into KaTeX HTML before sanitizing. */
function rehypeRenderMath() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (index == null || !parent) return;
      if (node.tagName === "pre") {
        const code = firstCodeChild(node);
        if (code && mathKind(code)) {
          parent.children[index] = mathElement(elementText(code).trim(), true);
          return SKIP;
        }
      }
      const standalone = isMathOnlyParagraph(node);
      if (standalone) {
        parent.children[index] = mathElement(elementText(standalone).trim(), true);
        return SKIP;
      }
      const kind = mathKind(node);
      if (!kind) return;
      parent.children[index] = mathElement(elementText(node).trim(), kind === "display");
      return SKIP;
    });
  };
}

function rehypeSizedImages() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      if (node.tagName !== "img") return;
      const title = typeof node.properties?.title === "string" ? node.properties.title.trim() : "";
      if (!title) return;
      const classes = Array.isArray(node.properties.className)
        ? [...node.properties.className]
        : [];
      const widthMatch = /^(\d+)/.exec(title);
      if (widthMatch) {
        const width = Number(widthMatch[1]);
        node.properties.width = width;
        node.properties.style = `width:${width}px;max-width:100%;height:auto;object-fit:contain`;
      }
      if (/\bright\b/i.test(title)) classes.push("fw-img-right");
      else if (/\bleft\b/i.test(title)) classes.push("fw-img-left");
      if (classes.length) node.properties.className = classes;
      delete node.properties.title;
      delete node.properties.width;
      delete node.properties.height;
    });
  };
}

function rehypeSafeImages() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "img" || index == null || !parent) return;
      const src = node.properties?.src;
      const safe =
        typeof src === "string" &&
        (src.startsWith("data:") ||
          src.startsWith("http://") ||
          src.startsWith("https://") ||
          src.startsWith("blob:"));
      if (safe) return;
      const alt = typeof node.properties?.alt === "string" ? node.properties.alt : "image omitted";
      parent.children[index] = {
        type: "element",
        tagName: "span",
        properties: { className: ["prose-img-missing"] },
        children: [{ type: "text", value: `[${alt}]` }],
      };
    });
  };
}

function rehypeWrapTables() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, index, parent) => {
      if (node.tagName !== "table" || index == null || !parent) return;
      if ((parent as Element).tagName === "div") return;
      parent.children[index] = {
        type: "element",
        tagName: "div",
        properties: { className: ["prose-table-wrap"] },
        children: [node],
      };
    });
  };
}

function rehypeLockMath() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element) => {
      const classes = classNames(node);
      if (classes.includes("math-inline") || classes.includes("math-display")) {
        node.properties = { ...node.properties, contentEditable: "false" };
      }
    });
  };
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRenderMath)
  .use(rehypeRaw)
  .use(rehypeSizedImages)
  .use(rehypeSanitize, markdownSanitizeSchema)
  .use(rehypeSafeImages)
  .use(rehypeWrapTables)
  .use(rehypeLockMath)
  .use(rehypeStringify);

/** Inner pass without layout expansion (used for bodies inside :::item). */
async function renderMarkdownFragment(markdown: string): Promise<string> {
  if (!markdown.trim()) return "";
  const file = await processor.process(markdown);
  return String(file);
}

/** Markdown → sanitized HTML. Safe to run in a worker (no DOM). */
export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  if (!markdown.trim()) return "";
  if (!markdown.includes(":::")) {
    return renderMarkdownFragment(markdown);
  }
  // Layout expand renders nested markdown fragments (already sanitized).
  return expandMarkdownLayoutDirectivesAsync(markdown, renderMarkdownFragment);
}
