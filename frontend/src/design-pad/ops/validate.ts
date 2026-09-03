import type { DesignDocument } from "../types";
import { isContainer, isValidVariableName } from "../types";
import { findNode, findParent } from "../store";
import type { DesignOp } from "./schema";
import { NODE_REF_ALIASES } from "./schema";

function isAlias(id: string): boolean {
  return (NODE_REF_ALIASES as readonly string[]).includes(id);
}

export function validateOp(doc: DesignDocument, op: DesignOp): string | null {
  const rootId = doc.root.id;

  switch (op.op) {
    case "select": {
      if (isAlias(op.id)) return null;
      if (!findNode(doc.root, op.id)) return `Unknown node id: ${op.id}`;
      return null;
    }
    case "add_element": {
      if (isAlias(op.parentId)) return null;
      const parent = findNode(doc.root, op.parentId);
      if (!parent) return `Unknown parent id: ${op.parentId}`;
      if (!isContainer(parent.kind)) return `Parent ${op.parentId} is not a box`;
      return null;
    }
    case "remove_element": {
      if (op.id === rootId) return "Cannot remove root";
      if (isAlias(op.id)) return null;
      if (!findNode(doc.root, op.id)) return `Unknown node id: ${op.id}`;
      return null;
    }
    case "update_label":
    case "update_style":
    case "update_level":
    case "move_node":
    case "resize_node":
    case "update_box":
    case "update_layout_props":
    case "toggle_auto_layout":
    case "update_image":
    case "update_node": {
      if (!isAlias(op.id) && !findNode(doc.root, op.id)) return `Unknown node id: ${op.id}`;
      if (op.op === "update_level" && (op.level < 1 || op.level > 6)) {
        return "Heading level must be 1–6";
      }
      return null;
    }
    case "move_in_tree": {
      if (op.id === rootId) return "Cannot move root";
      if (!isAlias(op.id) && !findNode(doc.root, op.id)) return `Unknown node id: ${op.id}`;
      if (!isAlias(op.parentId)) {
        const parent = findNode(doc.root, op.parentId);
        if (!parent) return `Unknown parent id: ${op.parentId}`;
        if (!isContainer(parent.kind)) return `Parent ${op.parentId} is not a box`;
      }
      if (op.index < 0) return "Index must be >= 0";
      return null;
    }
    case "add_variable": {
      if (!isValidVariableName(op.name)) return `Invalid variable name: ${op.name}`;
      if (doc.variables.some((v) => v.name === op.name)) return `Variable already exists: ${op.name}`;
      return null;
    }
    case "update_variable":
    case "remove_variable": {
      if (!doc.variables.some((v) => v.id === op.id)) return `Unknown variable id: ${op.id}`;
      if (op.op === "update_variable" && op.patch.name && !isValidVariableName(op.patch.name)) {
        return `Invalid variable name: ${op.patch.name}`;
      }
      return null;
    }
    case "set_page_width": {
      if (op.w < 100) return "Page width must be at least 100";
      return null;
    }
    case "set_page_count": {
      if (op.n < 1) return "Page count must be at least 1";
      return null;
    }
    default:
      return `Unknown operation: ${"op" in op ? String((op as { op?: string }).op) : JSON.stringify(op)}`;
  }
}

export function validateOps(doc: DesignDocument, ops: DesignOp[]): OpValidation[] {
  const working = structuredClone(doc);
  const results: OpValidation[] = [];

  for (const op of ops) {
    const error = validateOp(working, op);
    if (error) {
      results.push({ op, ok: false, error });
      continue;
    }
    results.push({ op, ok: true });
    applyOpToWorkingDoc(working, op);
  }

  return results;
}

export type OpValidation = {
  op: DesignOp;
  ok: boolean;
  error?: string;
};

/** Lightweight simulation so sequential ops (e.g. add then update) validate correctly. */
function applyOpToWorkingDoc(doc: DesignDocument, op: DesignOp): void {
  switch (op.op) {
    case "add_element": {
      const parent = findNode(
        doc.root,
        isAlias(op.parentId) ? "root" : op.parentId,
      );
      if (!parent) return;
      const id = `sim_${parent.children.length}`;
      parent.children.push({
        id,
        kind: op.kind,
        label: op.kind,
        x: op.x ?? 0,
        y: op.y ?? 0,
        w: 100,
        h: 40,
        style: doc.root.style,
        layout: op.kind === "box" ? { direction: "column", gap: 12, padding: 16, align: "stretch", justify: "start" } : null,
        children: [],
      });
      break;
    }
    case "remove_element": {
      const parent = findParent(doc.root, op.id);
      if (parent) parent.children = parent.children.filter((c) => c.id !== op.id);
      break;
    }
    case "add_variable": {
      doc.variables.push({
        id: `sim_var_${doc.variables.length}`,
        name: op.name,
        label: op.label,
        type: op.type ?? "text",
        sampleValue: op.sampleValue ?? "",
      });
      break;
    }
    case "remove_variable": {
      doc.variables = doc.variables.filter((v) => v.id !== op.id);
      break;
    }
    default:
      break;
  }
}
