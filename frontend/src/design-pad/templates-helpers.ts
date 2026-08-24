import {
  type DesignDocument,
  type DesignNode,
  type LayoutProps,
  type NodeStyle,
  type VariableSchemaField,
  type VariableType,
  DEFAULT_LAYOUT,
  HEADING_LEVEL_PRESET,
  createNode,
  createVariable,
  nextId,
} from "./types";
import { arrange, resolveAutoSize } from "./layout/arrange";
import { enforcePageBounds } from "./layout/page-bounds";
import { estimateTextHeight, fitTextContent } from "./layout/text-fit";

export function heading(w: number, label: string, level: 1 | 2 | 3 = 2, align: "left" | "center" | "right" = "left") {
  const n = createNode("heading", 0, 0);
  n.label = label;
  n.level = level;
  n.w = w;
  n.style.fontSize = HEADING_LEVEL_PRESET[level].fontSize;
  n.style.align = align;
  n.style.color = "#0f172a";
  n.h = Math.max(n.h, estimateTextHeight(n));
  return n;
}

export function paragraph(
  w: number,
  h: number,
  label: string,
  align: "left" | "center" | "right" = "left",
  styleOverride?: Partial<NodeStyle>,
) {
  const n = createNode("paragraph", 0, 0);
  n.label = label;
  n.w = w;
  n.h = h;
  n.style.align = align;
  n.style.color = "#334155";
  if (styleOverride) n.style = { ...n.style, ...styleOverride };
  n.h = Math.max(n.h, estimateTextHeight(n));
  return n;
}

/** Invisible structural wrapper — no fill, border, or caption chip. */
export const INVISIBLE: Partial<NodeStyle> = {
  backgroundColor: "transparent",
  borderStyle: "none",
  borderWidth: 0,
};

/** Soft card for named sections. */
export const CARD: Partial<NodeStyle> = {
  backgroundColor: "#ffffff",
  borderStyle: "solid",
  borderWidth: 1,
  borderColor: "#e2e8f0",
};

export const LABEL_STYLE: Partial<NodeStyle> = {
  color: "#64748b",
  fontSize: 13,
};

export const VALUE_STYLE: Partial<NodeStyle> = {
  color: "#0f172a",
  fontSize: 13,
};

/** Printed section title (survives preview — editor captions do not). */
export function sectionTitle(width: number, text: string) {
  const n = createNode("heading", 0, 0);
  n.label = text;
  n.level = 3;
  n.w = width;
  n.style.fontSize = 15;
  n.style.bold = true;
  n.style.color = "#0f172a";
  n.h = Math.max(28, estimateTextHeight(n));
  return n;
}

/** Builds a Box and immediately resolves its auto-sized dimension. */
export function box(
  wGuess: number,
  hGuess: number,
  label: string,
  children: DesignNode[],
  layout: Partial<LayoutProps>,
  styleOverride?: Partial<NodeStyle>,
) {
  const n = createNode("box", 0, 0);
  n.label = label;
  n.layout = { ...DEFAULT_LAYOUT, ...layout };
  n.children = children;
  if (styleOverride) n.style = { ...n.style, ...styleOverride };

  n.w = wGuess;
  n.h = hGuess;
  if (children.length > 0) {
    const isRow = n.layout.direction === "row";
    const gapTotal = n.layout.gap * (children.length - 1);
    if (isRow) {
      if (n.layout.justify === "start") {
        n.w = children.reduce((a, c) => a + c.w, 0) + gapTotal + 2 * n.layout.padding;
      }
      n.h = Math.max(n.h, Math.max(...children.map((c) => c.h)) + 2 * n.layout.padding);
    } else if (n.layout.justify === "start") {
      n.h = children.reduce((a, c) => a + c.h, 0) + gapTotal + 2 * n.layout.padding;
    }
  }
  return n;
}

/** Label/value row that fits inside `width` without overflowing. */
export function infoRow(width: number, labelText: string, valueText: string) {
  const labelW = Math.min(150, Math.max(90, Math.floor(width * 0.4)));
  const valueW = Math.max(70, width - labelW);
  const label = paragraph(labelW, 28, labelText, "left", LABEL_STYLE);
  const valueNode = paragraph(valueW, 28, valueText, "right", VALUE_STYLE);
  return box(
    width,
    32,
    "Row",
    [label, valueNode],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
}

/** Two-column table row sized to exactly `width` (gap 0). */
export function twoColRow(
  width: number,
  left: string,
  right: string,
  caption = "Row",
  leftRatio = 0.72,
  header = false,
) {
  const leftW = Math.floor(width * leftRatio);
  const rightW = width - leftW;
  const style = header
    ? { ...LABEL_STYLE, fontSize: 12, bold: true as const }
    : VALUE_STYLE;
  return box(
    width,
    32,
    caption,
    [
      paragraph(leftW, 28, left, "left", style),
      paragraph(rightW, 28, right, "right", style),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
}

/** Three-column table row. */
export function threeColRow(
  width: number,
  a: string,
  b: string,
  c: string,
  ratios: [number, number, number] = [0.45, 0.3, 0.25],
  header = false,
) {
  const aw = Math.floor(width * ratios[0]);
  const bw = Math.floor(width * ratios[1]);
  const cw = width - aw - bw;
  const style = header
    ? { ...LABEL_STYLE, fontSize: 12, bold: true as const }
    : VALUE_STYLE;
  return box(
    width,
    32,
    "Row",
    [
      paragraph(aw, 28, a, "left", style),
      paragraph(bw, 28, b, "left", style),
      paragraph(cw, 28, c, "right", style),
    ],
    { direction: "row", justify: "space-between", align: "center", padding: 0, gap: 0 },
    INVISIBLE,
  );
}

/** Mount top-level sections on an auto-arranged page column. */
export function assemblePage(
  doc: DesignDocument,
  sections: DesignNode[],
  opts: { gap?: number; padding?: number } = {},
) {
  const gap = opts.gap ?? 24;
  const padding = opts.padding ?? 40;
  doc.root.layout = {
    direction: "column",
    gap,
    padding,
    align: "stretch",
    justify: "start",
  };
  doc.root.children = sections;
  for (const section of sections) {
    section.x = 0;
    section.y = 0;
  }
  fitTextContent(doc.root);
  resolveAutoSize(doc.root);
  arrange(doc.root);
  enforcePageBounds(doc.root, doc.pageSize);
}

type ScalarVarEntry = [name: string, label: string, type: VariableType, sampleValue: string];
type ListFieldEntry = [name: string, label: string, type: VariableSchemaField["type"]];
type ListVarEntry = [
  name: string,
  label: string,
  type: "list",
  sampleValue: string,
  itemFields: ListFieldEntry[],
];
export type VarEntry = ScalarVarEntry | ListVarEntry;

/** Declares a template's variables in one shot. */
export function declareVars(doc: DesignDocument, entries: VarEntry[]) {
  doc.variables = entries.map((entry) => {
    const [name, label, type, sampleValue] = entry;
    const variable = createVariable(name, label, type, sampleValue);
    if (type === "list" && entry.length === 5) {
      variable.itemSchema = entry[4].map(([fieldName, fieldLabel, fieldType]) => ({
        id: nextId("field"),
        name: fieldName,
        label: fieldLabel,
        type: fieldType,
      }));
    }
    return variable;
  });
}
