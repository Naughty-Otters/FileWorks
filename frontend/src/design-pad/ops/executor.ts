import { useEditorStore } from "../store";
import type { DesignOp } from "./schema";
import type { ApplyOpsResult, OpResult } from "./schema";
import { validateOp } from "./validate";

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

export async function applyDesignOps(ops: DesignOp[]): Promise<ApplyOpsResult> {
  const store = useEditorStore.getState();
  store.beginHistoryGroup();

  const results: OpResult[] = [];
  const affectedNodeIds = new Set<string>();
  let needsRelayout = false;
  let lastCreatedId: string | undefined;

  try {
    for (const op of ops) {
      const doc = useEditorStore.getState().doc;
      const error = validateOp(doc, op);
      if (error) {
        results.push({ ok: false, op, error });
        continue;
      }

      try {
        const createdId = executeOp(op, lastCreatedId);
        if (createdId) lastCreatedId = createdId;
        if (op.op !== "select" && "id" in op && typeof op.id === "string") {
          affectedNodeIds.add(op.id);
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

  return { results, affectedNodeIds: [...affectedNodeIds] };
}

function executeOp(op: DesignOp, lastCreatedId?: string): string | undefined {
  const store = useEditorStore.getState();

  switch (op.op) {
    case "select":
      store.select(op.id);
      return undefined;
    case "add_element": {
      const parentId = op.parentId === "last_created" && lastCreatedId
        ? findParentIdForNode(lastCreatedId) ?? op.parentId
        : op.parentId;
      const x = op.x ?? 16;
      const y = op.y ?? 16;
      const before = useEditorStore.getState().selectedId;
      store.addElement(op.kind, parentId, x, y);
      const after = useEditorStore.getState().selectedId;
      return after && after !== before ? after : after ?? undefined;
    }
    case "remove_element":
      store.removeElement(op.id);
      return undefined;
    case "update_label":
      store.updateLabel(op.id, op.label);
      return undefined;
    case "update_style":
      store.updateStyle(op.id, op.patch);
      return undefined;
    case "update_level":
      store.updateLevel(op.id, op.level);
      return undefined;
    case "move_node":
      store.moveNode(op.id, op.x, op.y);
      return undefined;
    case "resize_node":
      store.resizeNode(op.id, op.w, op.h);
      return undefined;
    case "update_box":
      store.updateBox(op.id, op.box);
      return undefined;
    case "update_layout_props":
      store.updateLayoutProps(op.id, op.patch);
      return undefined;
    case "toggle_auto_layout":
      store.toggleAutoLayout(op.id, op.enabled);
      return undefined;
    case "move_in_tree":
      store.moveNodeInTree(
        op.id,
        op.parentId,
        op.index,
        op.x !== undefined && op.y !== undefined ? { x: op.x, y: op.y } : undefined,
      );
      return undefined;
    case "update_image":
      store.updateImage(op.id, op.patch);
      return undefined;
    case "update_node":
      store.updateNode(op.id, op.patch);
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
    default:
      throw new Error("Unknown operation");
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
