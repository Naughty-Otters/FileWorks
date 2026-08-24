import type { DesignNode, PageSize } from "../types";

/** Keeps every block inside the document's physical boundaries:
 *
 * - Horizontally, a block can never overflow its parent's right edge —
 *   its width is clamped (shrunk) to fit instead, since "wider than the
 *   page" has no sensible meaning for a printable document.
 * - Vertically, content is never clipped: the page grows (in whole-page
 *   increments) to fit whatever the deepest content's bottom edge needs.
 *   It only ever grows here — shrinking back down is a deliberate action
 *   via setPageCount, not an automatic side effect of a routine edit.
 *
 * Mutates `root` in place; call after every geometry change. */
export function enforcePageBounds(root: DesignNode, pageSize: PageSize) {
  /** `parentContentRight` is the right edge of the parent's content box in
   * the same coordinate system as `node.x` (parent.w - parentPadding).
   * Auto-layout children are already offset by padding, so we must not
   * subtract padding again via (innerW - x). */
  function clampWidth(node: DesignNode, parentContentRight: number | null) {
    if (node.id !== "root" && parentContentRight != null) {
      node.w = Math.min(node.w, Math.max(20, parentContentRight - node.x));
    }
    const pad = node.layout ? node.layout.padding : 0;
    const contentRight = node.w - pad;
    for (const child of node.children) clampWidth(child, contentRight);
  }
  clampWidth(root, null);

  let maxBottom = 0;
  function walkBottom(node: DesignNode, ancestorY: number) {
    const absY = ancestorY + node.y;
    if (node.id !== "root") maxBottom = Math.max(maxBottom, absY + node.h);
    const childAncestorY = node.id === "root" ? 0 : absY;
    for (const child of node.children) walkBottom(child, childAncestorY);
  }
  walkBottom(root, 0);

  const neededPages = Math.max(1, Math.ceil(maxBottom / pageSize.h));
  root.w = pageSize.w;
  root.h = Math.max(root.h, neededPages * pageSize.h);
}
