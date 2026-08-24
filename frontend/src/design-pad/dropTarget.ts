import type { DesignNode } from "./types";
import { isContainer } from "./types";
import { findNode, findParent } from "./store";

/** All ids in `node`'s own subtree (including itself). Pass as the
 * exclusion set so a container can't be dropped into itself or a child. */
export function collectIds(node: DesignNode): Set<string> {
  const set = new Set<string>();
  (function walk(n: DesignNode) {
    set.add(n.id);
    n.children.forEach(walk);
  })(node);
  return set;
}

/** Topmost box under the given screen point, or null if none. Excludes
 * ids in `excludeIds` (typically the dragged node's own subtree) so you
 * can't drop a container into itself. */
export function findDropContainerId(
  clientX: number,
  clientY: number,
  excludeIds?: Set<string>,
): string | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (!el.classList.contains("shape-box")) continue;
    const id = el.getAttribute("data-id");
    if (!id) continue;
    if (excludeIds?.has(id)) continue;
    return id;
  }
  return null;
}

/** The chain of shape ids from the page root down to `el` (inclusive),
 * e.g. ["root", "outerBoxId", "innerHeadingId"]. Lets a click resolve to
 * "the outermost block under the cursor" on a fresh click, and "the exact
 * thing under the cursor" once you've already drilled into that block —
 * the same two-tier selection model Figma uses for groups. */
export function shapeAncestorPath(el: Element): string[] {
  const path: string[] = [];
  let current: Element | null = el;
  while (current) {
    if (current.classList?.contains("shape")) {
      const id = current.getAttribute("data-id");
      if (id) path.unshift(id);
    }
    current = current.parentElement;
  }
  return path;
}

export interface ReorderAnchor {
  /** Container the dragged node will land in. */
  parentId: string;
  /** The sibling being dropped next to, or null when dropping into empty
   * space (appends at the end). */
  anchorId: string | null;
  zone: "before" | "after" | "into";
  /** Index within `parentId`'s children the node should be spliced to. */
  index: number;
}

/** Resolves what a drag-and-drop gesture over the canvas is currently
 * hovering: a sibling to reorder next to (top/bottom half of that
 * sibling's box), or a container to drop into (its own empty space).
 * Works the same regardless of whether the target stacks automatically
 * or is freeform — callers decide what to do with the parent's layout
 * mode once they have the resolved parent/index. */
export function findReorderAnchor(
  root: DesignNode,
  clientX: number,
  clientY: number,
  excludeIds: Set<string>,
): ReorderAnchor | null {
  const stack = document.elementsFromPoint(clientX, clientY);
  const topEl = stack.find((el) => {
    const id = el.getAttribute("data-id");
    return el.classList.contains("shape") && id && !excludeIds.has(id);
  });
  if (!topEl) return null;
  const topId = topEl.getAttribute("data-id")!;
  const topNode = findNode(root, topId);
  if (!topNode) return null;

  if (isContainer(topNode.kind)) {
    return { parentId: topId, anchorId: null, zone: "into", index: topNode.children.length };
  }

  const parent = findParent(root, topId);
  if (!parent) return null;
  const rect = topEl.getBoundingClientRect();
  const isRow = parent.layout?.direction === "row";
  const pos = isRow ? clientX : clientY;
  const mid = isRow ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
  const idx = parent.children.findIndex((c) => c.id === topId);
  const zone: "before" | "after" = pos < mid ? "before" : "after";
  const index = zone === "before" ? idx : idx + 1;
  return { parentId: parent.id, anchorId: topId, zone, index };
}

/** Like `findReorderAnchor`, but only considers descendants of `parentId`.
 * Used while dragging to keep a block inside its original container until
 * the pointer actually leaves that container's bounds. */
export function findReorderAnchorInParent(
  root: DesignNode,
  parentId: string,
  clientX: number,
  clientY: number,
  excludeIds: Set<string>,
): ReorderAnchor | null {
  const parent = findNode(root, parentId);
  if (!parent) return null;

  const stack = document.elementsFromPoint(clientX, clientY);
  const topEl = stack.find((el) => {
    const id = el.getAttribute("data-id");
    if (!id || excludeIds.has(id)) return false;
    if (id === parentId) return true;
    return findParent(root, id)?.id === parentId;
  });
  if (!topEl) return null;

  const topId = topEl.getAttribute("data-id")!;
  if (topId === parentId) {
    return { parentId, anchorId: null, zone: "into", index: parent.children.length };
  }

  const topNode = findNode(root, topId);
  if (!topNode) return null;

  const rect = topEl.getBoundingClientRect();
  const isRow = parent.layout?.direction === "row";
  const pos = isRow ? clientX : clientY;
  const mid = isRow ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
  const idx = parent.children.findIndex((c) => c.id === topId);
  if (idx < 0) return null;
  const zone: "before" | "after" = pos < mid ? "before" : "after";
  const index = zone === "before" ? idx : idx + 1;
  return { parentId, anchorId: topId, zone, index };
}

function pointInRect(x: number, y: number, rect: DOMRect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Resolve a drop target while dragging, pinning to `startParentId` until
 * the pointer leaves that container's screen bounds. */
export function resolveDragAnchor(
  root: DesignNode,
  clientX: number,
  clientY: number,
  excludeIds: Set<string>,
  startParentId: string,
  parentScreenRect: DOMRect | null,
): { anchor: ReorderAnchor; targetIsFreeform: boolean } | null {
  const startParent = findNode(root, startParentId);
  if (!startParent) return null;

  if (parentScreenRect && pointInRect(clientX, clientY, parentScreenRect)) {
    const pinned =
      findReorderAnchorInParent(root, startParentId, clientX, clientY, excludeIds) ??
      ({ parentId: startParentId, anchorId: null, zone: "into", index: startParent.children.length } as ReorderAnchor);
    return { anchor: pinned, targetIsFreeform: startParent.layout === null };
  }

  const anchor = findReorderAnchor(root, clientX, clientY, excludeIds);
  if (!anchor) return null;
  const targetParent = findNode(root, anchor.parentId);
  return { anchor, targetIsFreeform: !targetParent || targetParent.layout === null };
}
