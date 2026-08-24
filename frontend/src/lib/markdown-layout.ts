/**
 * Lightweight Markdown layout directives (docs-style flex/grid).
 *
 * Syntax:
 *
 *   :::flex gap=16 justify=between
 *   :::item
 *   Left column
 *   :::
 *   :::item
 *   Right column
 *   :::
 *   :::
 *
 *   :::grid cols=2 gap=12
 *   :::item
 *   **A**
 *   :::
 *   :::item
 *   B
 *   :::
 *   :::
 *
 * Inner item bodies are rendered as Markdown so formatting still works.
 */

type AttrMap = Record<string, string>;
type LayoutKind = "flex" | "grid" | "columns" | "item";

function parseAttrs(raw: string): AttrMap {
  const attrs: AttrMap = {};
  const re = /([A-Za-z_][\w-]*)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    attrs[match[1]] = match[2] ?? match[3] ?? match[4] ?? "true";
  }
  return attrs;
}

function styleFromAttrs(kind: "flex" | "grid" | "columns", attrs: AttrMap): string {
  const parts: string[] = ["box-sizing:border-box", "width:100%"];
  const gap = attrs.gap || attrs["gap-x"] || "16";
  if (kind === "flex") {
    parts.push("display:flex", "flex-wrap:wrap");
    parts.push(`flex-direction:${attrs.direction === "column" ? "column" : "row"}`);
    parts.push(`gap:${/^\d+$/.test(gap) ? `${gap}px` : gap}`);
    const justify = attrs.justify || attrs["justify-content"];
    if (justify) {
      const map: Record<string, string> = {
        start: "flex-start",
        end: "flex-end",
        center: "center",
        between: "space-between",
        around: "space-around",
        evenly: "space-evenly",
        "space-between": "space-between",
      };
      parts.push(`justify-content:${map[justify] || justify}`);
    }
    const align = attrs.align || attrs["align-items"];
    if (align) {
      const map: Record<string, string> = {
        start: "flex-start",
        end: "flex-end",
        center: "center",
        stretch: "stretch",
        baseline: "baseline",
      };
      parts.push(`align-items:${map[align] || align}`);
    }
  } else if (kind === "grid") {
    const cols = Math.max(1, Number(attrs.cols || attrs.columns || 2) || 2);
    parts.push("display:grid", `grid-template-columns:repeat(${cols},minmax(0,1fr))`);
    parts.push(`gap:${/^\d+$/.test(gap) ? `${gap}px` : gap}`);
  } else {
    const count = Math.max(1, Number(attrs.count || attrs.cols || 2) || 2);
    parts.push(`column-count:${count}`);
    parts.push(`column-gap:${/^\d+$/.test(gap) ? `${gap}px` : gap}`);
  }
  return parts.join(";");
}

function openTag(kind: LayoutKind, attrs: AttrMap): string {
  if (kind === "item") {
    const grow = attrs.grow || attrs.flex;
    const style = ["min-width:0", "box-sizing:border-box", grow ? `flex:${grow}` : "flex:1 1 0"].join(
      ";",
    );
    return `<div class="md-layout-item" style="${style}">`;
  }
  const cls =
    kind === "flex" ? "md-layout-flex" : kind === "grid" ? "md-layout-grid" : "md-layout-columns";
  return `<div class="${cls}" style="${styleFromAttrs(kind, attrs)}">`;
}

function parseKind(name: string): LayoutKind | null {
  const key = name.toLowerCase();
  if (key === "flex" || key === "flexs") return "flex";
  if (key === "grid" || key === "grids") return "grid";
  if (key === "columns" || key === "cols") return "columns";
  if (key === "item" || key === "flex-item" || key === "grid-item" || key === "column") return "item";
  return null;
}

/** Sync expand (structure only; nested Markdown stays literal). */
export function expandMarkdownLayoutDirectives(markdown: string): string {
  if (!markdown.includes(":::")) return markdown;
  const out: string[] = [];
  const stack: LayoutKind[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    const open = /^:::(\w+)(?:\s+(.*))?$/.exec(trimmed);
    if (open) {
      const kind = parseKind(open[1]);
      if (kind) {
        out.push(openTag(kind, parseAttrs(open[2] || "")));
        stack.push(kind);
        continue;
      }
    }
    if (trimmed === ":::" && stack.length) {
      stack.pop();
      out.push("</div>");
      continue;
    }
    out.push(line);
  }
  while (stack.length) {
    stack.pop();
    out.push("</div>");
  }
  return out.join("\n");
}

type InnerRenderer = (markdown: string) => Promise<string>;

type Node =
  | { type: "text"; value: string }
  | { type: "layout"; kind: Exclude<LayoutKind, "item">; attrs: AttrMap; children: Node[] }
  | { type: "item"; attrs: AttrMap; children: Node[] };

/**
 * Expand layout directives and render nested Markdown inside items.
 * Avoids CommonMark's "no markdown inside HTML blocks" limitation.
 */
export async function expandMarkdownLayoutDirectivesAsync(
  markdown: string,
  renderInner: InnerRenderer,
): Promise<string> {
  if (!markdown.includes(":::")) return markdown;

  const rootChildren: Node[] = [];
  const stack: Array<{ children: Node[] }> = [{ children: rootChildren }];
  let buffer: string[] = [];

  const flushText = () => {
    if (!buffer.length) return;
    stack[stack.length - 1].children.push({ type: "text", value: buffer.join("\n") });
    buffer = [];
  };

  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    const open = /^:::(\w+)(?:\s+(.*))?$/.exec(trimmed);
    if (open) {
      const kind = parseKind(open[1]);
      if (kind) {
        flushText();
        const children: Node[] = [];
        const attrs = parseAttrs(open[2] || "");
        const node: Node =
          kind === "item"
            ? { type: "item", attrs, children }
            : { type: "layout", kind, attrs, children };
        stack[stack.length - 1].children.push(node);
        stack.push({ children });
        continue;
      }
    }
    if (trimmed === ":::" && stack.length > 1) {
      flushText();
      stack.pop();
      continue;
    }
    buffer.push(line);
  }
  flushText();

  async function renderNodes(nodes: Node[]): Promise<string> {
    const parts: string[] = [];
    for (const node of nodes) {
      if (node.type === "text") {
        const text = node.value.trim();
        if (text) parts.push(await renderInner(text));
        continue;
      }
      if (node.type === "item") {
        parts.push(openTag("item", node.attrs));
        parts.push(await renderNodes(node.children));
        parts.push("</div>");
        continue;
      }
      parts.push(openTag(node.kind, node.attrs));
      parts.push(await renderNodes(node.children));
      parts.push("</div>");
    }
    return parts.join("\n");
  }

  return renderNodes(rootChildren);
}
