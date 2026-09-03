import { useEditorStore } from "../store";
import { findNode } from "../store";
import { isContainer, nextStackedPosition } from "../types";
import type { DesignOp } from "./schema";
import type { ApplyOpsResult, OpResult } from "./schema";
import { LAST_CREATED, LAST_CREATED_SIBLING, LAST_COLUMN, NODE_REF_ALIASES } from "./schema";
import { validateOp } from "./validate";

export { LAST_CREATED, LAST_CREATED_SIBLING, LAST_COLUMN };

const LAYOUT_OPS = new Set<DesignOp["op"]>([
  "add_element",
  "remove_element",
  "move_node",
  "resize_node",
  "update_box",
  "update_layout_props",
  "toggle_auto_layout",
  "move_in_tree",
  "set_page_width",
  "set_page_count",
  "update_node",
]);

/** Shared with backend ``AiIdCounter`` so polish/repair ops hit the same nodes. */
let aiElementSeq = 0;

export function resetAiIdSequence(): void {
  aiElementSeq = 0;
}

function nextAiElementId(kind: string): string {
  aiElementSeq += 1;
  return `ai_${kind}_${aiElementSeq}`;
}

export async function applyDesignOps(
  ops: DesignOp[],
  opts?: { useAiIds?: boolean; continueLastCreated?: string },
): Promise<ApplyOpsResult> {
  const store = useEditorStore.getState();
  store.beginHistoryGroup();

  const results: OpResult[] = [];
  const affectedNodeIds = new Set<string>();
  let needsRelayout = false;
  let lastCreatedId: string | undefined = opts?.continueLastCreated;
  const useAiIds = opts?.useAiIds !== false;

  try {
    for (const op of ops) {
      const doc = useEditorStore.getState().doc;
      const error = validateOp(doc, op);
      if (error) {
        results.push({ ok: false, op, error });
        continue;
      }

      try {
        const createdId = executeOp(op, lastCreatedId, useAiIds);
        if (createdId) lastCreatedId = createdId;
        if (op.op !== "select" && "id" in op && typeof op.id === "string") {
          const resolved = (NODE_REF_ALIASES as readonly string[]).includes(op.id)
            ? lastCreatedId
            : op.id;
          if (resolved) affectedNodeIds.add(resolved);
        }
        if (createdId) affectedNodeIds.add(createdId);
        if (LAYOUT_OPS.has(op.op)) needsRelayout = true;
        results.push({ ok: true, op, createdId });
      } catch (e) {
        results.push({
          ok: false,
          op,
          error: e instanceof Error ? e.message : "Operation failed",
        });
      }
    }
  } finally {
    useEditorStore.getState().commitHistoryGroup();
  }

  if (needsRelayout) {
    await useEditorStore.getState().relayoutDocument();
  }

  return { results, affectedNodeIds: [...affectedNodeIds], lastCreatedId };
}

function requireLastCreated(lastCreatedId?: string): string {
  if (!lastCreatedId) {
    throw new Error("No last_created node in this step — add_element first");
  }
  return lastCreatedId;
}

/** Resolve `last_created` / `last_created_sibling` / `last_column` aliases. */
export function resolveNodeRef(ref: string, lastCreatedId?: string): string {
  if (ref === LAST_CREATED) return requireLastCreated(lastCreatedId);
  if (ref === LAST_CREATED_SIBLING) {
    const id = requireLastCreated(lastCreatedId);
    return findParentIdForNode(id) ?? id;
  }
  if (ref === LAST_COLUMN) return resolveLastColumn(lastCreatedId);
  return ref;
}

/** Walk to the nearest column-layout box (section), skipping row wrappers. */
export function resolveLastColumn(lastCreatedId?: string): string {
  const start = requireLastCreated(lastCreatedId);
  const doc = useEditorStore.getState().doc;
  let node = findNode(doc.root, start);
  if (node && isContainer(node.kind) && node.layout?.direction === "column") {
    return node.id;
  }
  let parentId = findParentIdForNode(start);
  while (parentId) {
    const parent = findNode(doc.root, parentId);
    if (!parent) break;
    if (isContainer(parent.kind) && parent.layout?.direction === "column") {
      return parent.id;
    }
    parentId = findParentIdForNode(parentId);
  }
  return "root";
}

/** Parent for a new child: nest into last box, else sibling under its parent. */
export function resolveParentRef(ref: string, lastCreatedId?: string): string {
  if (ref === LAST_COLUMN) return resolveLastColumn(lastCreatedId);
  if (ref === LAST_CREATED_SIBLING) {
    const id = requireLastCreated(lastCreatedId);
    return findParentIdForNode(id) ?? id;
  }
  if (ref === LAST_CREATED) {
    const id = requireLastCreated(lastCreatedId);
    const doc = useEditorStore.getState().doc;
    const node = findNode(doc.root, id);
    if (node && isContainer(node.kind)) return id;
    return findParentIdForNode(id) ?? "root";
  }
  return ref;
}

function executeOp(op: DesignOp, lastCreatedId?: string, useAiIds = true): string | undefined {
  const store = useEditorStore.getState();

  switch (op.op) {
    case "select":
      store.select(resolveNodeRef(op.id, lastCreatedId));
      return undefined;
    case "add_element": {
      const parentId = resolveParentRef(op.parentId, lastCreatedId);
      const doc = useEditorStore.getState().doc;
      const parent = findNode(doc.root, parentId);
      // Match Palette: omit x/y → stack below siblings (never pile at 16,16).
      // Auto-layout parents ignore freeform coords after relayout anyway.
      let x = op.x;
      let y = op.y;
      if (x === undefined || y === undefined) {
        const stacked = parent ? nextStackedPosition(parent) : { x: 16, y: 16 };
        x = x ?? stacked.x;
        y = y ?? stacked.y;
      }
      const before = useEditorStore.getState().selectedId;
      const aiId = useAiIds ? nextAiElementId(op.kind) : undefined;
      store.addElement(op.kind, parentId, x, y, aiId);
      const after = useEditorStore.getState().selectedId;
      return after && after !== before ? after : after ?? undefined;
    }
    case "remove_element":
      store.removeElement(resolveNodeRef(op.id, lastCreatedId));
      return undefined;
    case "update_label":
      store.updateLabel(resolveNodeRef(op.id, lastCreatedId), op.label);
      return undefined;
    case "update_style":
      store.updateStyle(resolveNodeRef(op.id, lastCreatedId), op.patch);
      return undefined;
    case "update_level":
      store.updateLevel(resolveNodeRef(op.id, lastCreatedId), op.level);
      return undefined;
    case "move_node":
      store.moveNode(resolveNodeRef(op.id, lastCreatedId), op.x, op.y);
      return undefined;
    case "resize_node":
      store.resizeNode(resolveNodeRef(op.id, lastCreatedId), op.w, op.h);
      return undefined;
    case "update_box":
      store.updateBox(resolveNodeRef(op.id, lastCreatedId), op.box);
      return undefined;
    case "update_layout_props":
      store.updateLayoutProps(resolveNodeRef(op.id, lastCreatedId), op.patch);
      return undefined;
    case "toggle_auto_layout":
      store.toggleAutoLayout(resolveNodeRef(op.id, lastCreatedId), op.enabled);
      return undefined;
    case "move_in_tree":
      store.moveNodeInTree(
        resolveNodeRef(op.id, lastCreatedId),
        resolveParentRef(op.parentId, lastCreatedId),
        op.index,
        op.x !== undefined && op.y !== undefined ? { x: op.x, y: op.y } : undefined,
      );
      return undefined;
    case "update_image":
      store.updateImage(resolveNodeRef(op.id, lastCreatedId), op.patch);
      return undefined;
    case "update_node":
      store.updateNode(resolveNodeRef(op.id, lastCreatedId), op.patch);
      return undefined;
    case "add_variable":
      store.addVariable(op.name, op.label, op.type, op.sampleValue);
      return undefined;
    case "update_variable":
      store.updateVariable(op.id, op.patch);
      return undefined;
    case "remove_variable":
      store.removeVariable(op.id);
      return undefined;
    case "set_page_width":
      store.setPageWidth(op.w);
      return undefined;
    case "set_page_count":
      store.setPageCount(op.n);
      return undefined;
    default: {
      const name = "op" in op ? String((op as { op?: string }).op) : "missing";
      throw new Error(`Unknown operation: ${name}`);
    }
  }
}

function findParentIdForNode(nodeId: string): string | null {
  const { doc } = useEditorStore.getState();
  function walk(node: typeof doc.root, parentId: string | null): string | null {
    if (node.id === nodeId) return parentId;
    for (const child of node.children) {
      const found = walk(child, node.id);
      if (found) return found;
    }
    return null;
  }
  return walk(doc.root, null);
}
