import type { DesignNode } from "../types";

/** Matches `.shape-heading` / `.shape-paragraph` padding in design-pad.css. */
const TEXT_PAD_X = 12;
const TEXT_PAD_Y = 8;

/** Average glyph width as a fraction of font-size for Arial-like faces. */
const CHAR_WIDTH_RATIO = 0.52;

/**
 * Estimates the pixel height needed to show `node.label` without clipping,
 * given the node's width and font size. Used for preview/export fit and
 * for sizing text in built-in templates.
 */
export function estimateTextHeight(node: DesignNode): number {
  const fontSize = Math.max(8, node.style.fontSize || 14);
  const lineHeight = node.kind === "heading" ? 1.25 : 1.4;
  const lineHeightPx = fontSize * lineHeight;
  const contentW = Math.max(20, node.w - TEXT_PAD_X);
  const charsPerLine = Math.max(1, Math.floor(contentW / (fontSize * CHAR_WIDTH_RATIO)));
  const text = node.label || " ";

  let lines = 0;
  for (const part of text.split("\n")) {
    if (part.length === 0) {
      lines += 1;
      continue;
    }
    lines += Math.max(1, Math.ceil(part.length / charsPerLine));
  }
  lines = Math.max(1, lines);
  return Math.ceil(lines * lineHeightPx + TEXT_PAD_Y);
}

/** Grow every text leaf so its box is at least tall enough for its copy. */
export function fitTextContent(node: DesignNode): void {
  for (const child of node.children) fitTextContent(child);
  if (node.kind === "paragraph" || node.kind === "heading") {
    node.h = Math.max(node.h, estimateTextHeight(node));
  }
}
