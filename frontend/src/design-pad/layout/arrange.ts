import type { DesignNode, LayoutProps } from "../types";

/** Bottom-up pass: grow auto-layout containers (justify "start" only) to
 * fit their children. Mirrors `resolve_auto_size` in the Rust engine. */
export function resolveAutoSize(node: DesignNode): void {
  for (const child of node.children) resolveAutoSize(child);
  if (node.children.length === 0 || !node.layout) return;
  if (node.layout.justify !== "start") return;

  const isRow = node.layout.direction !== "column";
  const gapTotal = node.layout.gap * Math.max(0, node.children.length - 1);
  if (isRow) {
    const contentW = node.children.reduce((sum, c) => sum + c.w, 0) + gapTotal;
    node.w = contentW + 2 * node.layout.padding;
  } else {
    const contentH = node.children.reduce((sum, c) => sum + c.h, 0) + gapTotal;
    node.h = contentH + 2 * node.layout.padding;
  }
}

/** Recompute direct-child positions for one auto-layout container. */
function arrangeNode(node: DesignNode, props: LayoutProps): void {
  const isRow = props.direction !== "column";
  const innerW = Math.max(0, node.w - 2 * props.padding);
  const innerH = Math.max(0, node.h - 2 * props.padding);
  const innerMain = isRow ? innerW : innerH;
  const innerCross = isRow ? innerH : innerW;

  const n = node.children.length;
  const totalMain =
    node.children.reduce((sum, c) => sum + (isRow ? c.w : c.h), 0) +
    props.gap * Math.max(0, n - 1);
  const extra = Math.max(0, innerMain - totalMain);

  let cursor: number;
  let spacing: number;
  switch (props.justify) {
    case "end":
      cursor = extra;
      spacing = props.gap;
      break;
    case "center":
      cursor = extra / 2;
      spacing = props.gap;
      break;
    case "space-between":
      cursor = 0;
      spacing = n > 1 ? props.gap + extra / (n - 1) : props.gap;
      break;
    default:
      cursor = 0;
      spacing = props.gap;
  }

  for (const child of node.children) {
    const mainSize = isRow ? child.w : child.h;
    const crossSize = isRow ? child.h : child.w;

    let crossPos: number;
    let effectiveCrossSize: number;
    switch (props.align) {
      case "end":
        crossPos = innerCross - crossSize;
        effectiveCrossSize = crossSize;
        break;
      case "center":
        crossPos = (innerCross - crossSize) / 2;
        effectiveCrossSize = crossSize;
        break;
      case "stretch":
        crossPos = 0;
        effectiveCrossSize = innerCross;
        break;
      default:
        crossPos = 0;
        effectiveCrossSize = crossSize;
    }

    if (isRow) {
      child.x = props.padding + cursor;
      child.y = props.padding + crossPos;
      child.h = effectiveCrossSize;
    } else {
      child.y = props.padding + cursor;
      child.x = props.padding + crossPos;
      child.w = effectiveCrossSize;
    }

    cursor += mainSize + spacing;
  }
}

/** Recompute positions for `node` and every auto-layout descendant. Mirrors
 * `arrange` in the Rust engine. */
export function arrange(node: DesignNode): void {
  if (node.layout) arrangeNode(node, node.layout);
  for (const child of node.children) arrange(child);
}

/** Walk from `startId` up to the page root, re-arranging each auto-layout
 * ancestor. Optionally re-run hug-contents sizing on ancestors when a
 * child's main-axis size changed. */
function relayoutAncestors(
  root: DesignNode,
  startId: string,
  findParentFn: (root: DesignNode, id: string) => DesignNode | null,
  resolveAncestors: boolean,
): void {
  let currentId = startId;
  for (;;) {
    const parent = findParentFn(root, currentId);
    if (!parent || parent.id === "root") break;

    if (parent.layout) {
      if (resolveAncestors && parent.layout.justify === "start") {
        const isRow = parent.layout.direction !== "column";
        const gapTotal = parent.layout.gap * Math.max(0, parent.children.length - 1);
        if (isRow) {
          parent.w =
            parent.children.reduce((sum, c) => sum + c.w, 0) + gapTotal + 2 * parent.layout.padding;
        } else {
          parent.h =
            parent.children.reduce((sum, c) => sum + c.h, 0) + gapTotal + 2 * parent.layout.padding;
        }
      }
      arrangeNode(parent, parent.layout);
    }

    currentId = parent.id;
  }
}

/** Re-layout only the branch that actually changed — the modified container,
 * its descendants, and auto-layout ancestors up to the page root. Sibling
 * branches (e.g. another box on the page) are left untouched. */
export function relayoutBranch(
  root: DesignNode,
  branchId: string,
  findParentFn: (root: DesignNode, id: string) => DesignNode | null,
): void {
  const branch = findNodeIn(root, branchId);
  if (!branch) return;

  resolveAutoSize(branch);
  arrange(branch);
  relayoutAncestors(root, branchId, findParentFn, true);
}

/** After an explicit resize, only re-arrange what the new dimensions affect.
 * Skips hug-contents on the resized node itself so the user's size sticks,
 * and never touches unrelated sibling boxes on the page. */
export function relayoutAfterResize(
  root: DesignNode,
  resizedId: string,
  findParentFn: (root: DesignNode, id: string) => DesignNode | null,
): void {
  const node = findNodeIn(root, resizedId);
  if (!node) return;
  const parent = findParentFn(root, resizedId);

  if (node.layout !== null) {
    arrange(node);
    relayoutAncestors(root, resizedId, findParentFn, false);
  } else if (parent && parent.layout !== null) {
    relayoutBranch(root, parent.id, findParentFn);
  }
}

function findNodeIn(node: DesignNode, id: string): DesignNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNodeIn(child, id);
    if (found) return found;
  }
  return null;
}
