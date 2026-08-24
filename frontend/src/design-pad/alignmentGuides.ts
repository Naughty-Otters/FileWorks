export type Rect = { x: number; y: number; w: number; h: number };

export type AlignmentGuide = { axis: "x" | "y"; position: number };

const SNAP_THRESHOLD = 5;

function xEdges(r: Rect): number[] {
  return [r.x, r.x + r.w / 2, r.x + r.w];
}

function yEdges(r: Rect): number[] {
  return [r.y, r.y + r.h / 2, r.y + r.h];
}

/** Snap a dragged box to sibling and parent edges when within
 * `threshold` px, returning the adjusted position and guide lines to
 * draw in the parent's local coordinate space. */
export function computeAlignmentSnap(
  dragged: Rect,
  siblings: Rect[],
  parent: { w: number; h: number } | null,
  threshold = SNAP_THRESHOLD,
): { x: number; y: number; guides: AlignmentGuide[] } {
  const guides: AlignmentGuide[] = [];
  let { x, y, w, h } = dragged;

  const xRefs: number[] = [];
  const yRefs: number[] = [];
  for (const s of siblings) {
    xRefs.push(...xEdges(s));
    yRefs.push(...yEdges(s));
  }
  if (parent) {
    xRefs.push(0, parent.w / 2, parent.w);
    yRefs.push(0, parent.h / 2, parent.h);
  }

  let bestX: { dist: number; x: number; guide: number } | null = null;
  for (const ref of xRefs) {
    for (const offset of [0, w / 2, w]) {
      const dist = ref - (x + offset);
      if (Math.abs(dist) <= threshold && (!bestX || Math.abs(dist) < Math.abs(bestX.dist))) {
        bestX = { dist, x: x + dist, guide: ref };
      }
    }
  }
  if (bestX) {
    x = bestX.x;
    guides.push({ axis: "x", position: bestX.guide });
  }

  let bestY: { dist: number; y: number; guide: number } | null = null;
  for (const ref of yRefs) {
    for (const offset of [0, h / 2, h]) {
      const dist = ref - (y + offset);
      if (Math.abs(dist) <= threshold && (!bestY || Math.abs(dist) < Math.abs(bestY.dist))) {
        bestY = { dist, y: y + dist, guide: ref };
      }
    }
  }
  if (bestY) {
    y = bestY.y;
    guides.push({ axis: "y", position: bestY.guide });
  }

  return { x, y, guides };
}
