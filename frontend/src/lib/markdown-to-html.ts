import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";

export const markdownSanitizeSchema = {
  ...defaultSchema,
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
  ],
  attributes: {
    ...defaultSchema.attributes,
    "*": ["className", "class", "style", "id", "align", "colspan", "rowspan", "width", "height"],
    td: [...(defaultSchema.attributes?.td || []), "colspan", "rowspan", "align", "style"],
    th: [...(defaultSchema.attributes?.th || []), "colspan", "rowspan", "align", "style"],
    table: [...(defaultSchema.attributes?.table || []), "border", "style", "width"],
    span: ["style", "className", "class"],
    div: ["style", "className", "class", "align"],
    img: [...(defaultSchema.attributes?.img || []), "src", "alt", "title", "width", "height", "style"],
  },
};

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

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize, markdownSanitizeSchema)
  .use(rehypeSafeImages)
  .use(rehypeWrapTables)
  .use(rehypeStringify);

/** Markdown → sanitized HTML. Safe to run in a worker (no DOM). */
export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  if (!markdown.trim()) return "";
  const file = await processor.process(markdown);
  return String(file);
}
