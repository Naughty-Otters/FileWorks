"""Apply DesignOps to a DesignDocument on the server (parity with client executor).

Uses deterministic ``ai_<kind>_<n>`` ids so simulated polish/repair ops match the
client when ``applyDesignOps`` uses the same sequence.
"""

from __future__ import annotations

from typing import Any

from app.processing.template.layout import apply_full_layout
from app.processing.template.schema import (
    DesignDocument,
    DesignNode,
    NodeLayout,
    NodeStyle,
    VariableSchema,
)

LAST_CREATED = "last_created"
LAST_CREATED_SIBLING = "last_created_sibling"
LAST_COLUMN = "last_column"

_KIND_DEFAULTS: dict[str, dict[str, Any]] = {
    "box": {
        "label": "Box",
        "w": 400.0,
        "h": 160.0,
        "layout": NodeLayout(direction="column", gap=12, padding=16, align="stretch", justify="start"),
        "style": NodeStyle(
            background_color="#ffffff",
            border_style="solid",
            border_width=1,
            border_color="#e2e8f0",
        ),
    },
    "heading": {
        "label": "Heading",
        "w": 320.0,
        "h": 44.0,
        "level": 1,
        "style": NodeStyle(font_size=28, bold=True, color="#0f172a"),
    },
    "paragraph": {
        "label": "Paragraph text.",
        "w": 340.0,
        "h": 88.0,
        "style": NodeStyle(font_size=14, color="#334155"),
    },
    "image": {
        "label": "Image",
        "w": 300.0,
        "h": 200.0,
        "style": NodeStyle(
            background_color="#f1f5f9",
            border_style="dashed",
            border_width=1,
            border_color="#cbd5e1",
        ),
    },
}


class AiIdCounter:
    """Deterministic ids for agent-created nodes.

    Element and variable sequences are independent so client/server stay aligned
    even when ``add_variable`` ops are interleaved with ``add_element``.
    """

    def __init__(self) -> None:
        self.element_n = 0
        self.var_n = 0

    def next(self, kind: str) -> str:
        if kind == "var":
            self.var_n += 1
            return f"ai_var_{self.var_n}"
        self.element_n += 1
        return f"ai_{kind}_{self.element_n}"


def find_node(root: DesignNode, node_id: str) -> DesignNode | None:
    if root.id == node_id:
        return root
    for child in root.children:
        found = find_node(child, node_id)
        if found:
            return found
    return None


def find_parent(root: DesignNode, node_id: str) -> DesignNode | None:
    for child in root.children:
        if child.id == node_id:
            return root
        found = find_parent(child, node_id)
        if found:
            return found
    return None


def next_stacked_position(parent: DesignNode) -> tuple[float, float]:
    pad = 16.0
    if not parent.children:
        return pad, pad
    max_bottom = max(c.y + c.h for c in parent.children)
    return pad, max_bottom + 12.0


def _create_node(kind: str, x: float, y: float, node_id: str) -> DesignNode:
    defaults = _KIND_DEFAULTS[kind]
    style = defaults.get("style") or NodeStyle()
    return DesignNode.model_validate(
        {
            "id": node_id,
            "kind": kind,
            "label": defaults["label"],
            "level": defaults.get("level", 1),
            "x": x,
            "y": y,
            "w": defaults["w"],
            "h": defaults["h"],
            "style": style.model_dump(by_alias=True, mode="json"),
            "layout": (
                defaults["layout"].model_dump(by_alias=True, mode="json")
                if defaults.get("layout") is not None
                else None
            ),
            "children": [],
            **({"imageSrc": "", "objectFit": "cover"} if kind == "image" else {}),
        }
    )


def apply_design_ops(
    document: DesignDocument,
    ops: list[dict[str, Any]],
    *,
    id_counter: AiIdCounter | None = None,
) -> tuple[DesignDocument, list[str], AiIdCounter]:
    """Apply ops to a deep copy. Returns (doc, errors, id_counter)."""
    doc = document.model_copy(deep=True)
    counter = id_counter or AiIdCounter()
    errors: list[str] = []
    last_created: str | None = None

    def resolve_last_column() -> str:
        nonlocal last_created
        if not last_created:
            raise ValueError("No last_created node")
        node = find_node(doc.root, last_created)
        if node and node.type == "box" and node.layout and node.layout.direction == "column":
            return node.id
        parent = find_parent(doc.root, last_created)
        while parent is not None:
            if parent.type == "box" and parent.layout and parent.layout.direction == "column":
                return parent.id
            parent = find_parent(doc.root, parent.id)
        return "root"

    def resolve_ref(ref: str) -> str:
        nonlocal last_created
        if ref == LAST_CREATED:
            if not last_created:
                raise ValueError("No last_created node")
            return last_created
        if ref == LAST_CREATED_SIBLING:
            if not last_created:
                raise ValueError("No last_created node")
            parent = find_parent(doc.root, last_created)
            return parent.id if parent else last_created
        if ref == LAST_COLUMN:
            return resolve_last_column()
        return ref

    def resolve_parent(ref: str) -> str:
        if ref == LAST_COLUMN:
            return resolve_last_column()
        if ref == LAST_CREATED_SIBLING:
            return resolve_ref(ref)
        if ref == LAST_CREATED:
            node_id = resolve_ref(LAST_CREATED)
            node = find_node(doc.root, node_id)
            if node and node.type == "box":
                return node_id
            parent = find_parent(doc.root, node_id)
            return parent.id if parent else "root"
        return ref

    for op in ops:
        name = op.get("op")
        try:
            if name == "select":
                continue
            if name == "add_element":
                kind = str(op.get("kind") or "")
                if kind not in _KIND_DEFAULTS:
                    raise ValueError(f"Unknown kind {kind}")
                parent_id = resolve_parent(str(op.get("parentId") or "root"))
                parent = find_node(doc.root, parent_id)
                if not parent or parent.type != "box":
                    raise ValueError(f"Unknown parent {parent_id}")
                x = op.get("x")
                y = op.get("y")
                if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
                    sx, sy = next_stacked_position(parent)
                    x = float(x) if isinstance(x, (int, float)) else sx
                    y = float(y) if isinstance(y, (int, float)) else sy
                node_id = counter.next(kind)
                node = _create_node(kind, float(x), float(y), node_id)
                parent.children.append(node)
                last_created = node_id
            elif name == "remove_element":
                node_id = resolve_ref(str(op.get("id") or ""))
                if node_id == "root":
                    raise ValueError("Cannot remove root")
                parent = find_parent(doc.root, node_id)
                if not parent:
                    raise ValueError(f"Unknown node {node_id}")
                parent.children = [c for c in parent.children if c.id != node_id]
            elif name == "update_label":
                node = find_node(doc.root, resolve_ref(str(op.get("id") or "")))
                if not node:
                    raise ValueError("Unknown node")
                node.label = str(op.get("label") or "")
            elif name == "update_style":
                node = find_node(doc.root, resolve_ref(str(op.get("id") or "")))
                if not node:
                    raise ValueError("Unknown node")
                patch = op.get("patch") if isinstance(op.get("patch"), dict) else {}
                data = node.style.model_dump(by_alias=True, mode="json")
                data.update(patch)
                node.style = NodeStyle.model_validate(data)
            elif name == "update_level":
                node = find_node(doc.root, resolve_ref(str(op.get("id") or "")))
                if not node:
                    raise ValueError("Unknown node")
                node.level = int(op.get("level") or 1)
            elif name == "move_node":
                node = find_node(doc.root, resolve_ref(str(op.get("id") or "")))
                if not node:
                    raise ValueError("Unknown node")
                node.x = float(op["x"])
                node.y = float(op["y"])
            elif name == "resize_node":
                node = find_node(doc.root, resolve_ref(str(op.get("id") or "")))
                if not node:
                    raise ValueError("Unknown node")
                node.w = float(op["w"])
                node.h = float(op["h"])
            elif name == "update_box":
                node = find_node(doc.root, resolve_ref(str(op.get("id") or "")))
                if not node:
                    raise ValueError("Unknown node")
                box = op.get("box") if isinstance(op.get("box"), dict) else {}
                node.x = float(box["x"])
                node.y = float(box["y"])
                node.w = float(box["w"])
                node.h = float(box["h"])
            elif name == "update_layout_props":
                node = find_node(doc.root, resolve_ref(str(op.get("id") or "")))
                if not node:
                    raise ValueError("Unknown node")
                if node.layout is None:
                    node.layout = NodeLayout()
                patch = op.get("patch") if isinstance(op.get("patch"), dict) else {}
                data = node.layout.model_dump(by_alias=True, mode="json")
                data.update(patch)
                node.layout = NodeLayout.model_validate(data)
            elif name == "toggle_auto_layout":
                node = find_node(doc.root, resolve_ref(str(op.get("id") or "")))
                if not node:
                    raise ValueError("Unknown node")
                enabled = bool(op.get("enabled"))
                node.layout = (
                    NodeLayout(direction="column", gap=12, padding=16, align="stretch", justify="start")
                    if enabled
                    else None
                )
            elif name == "move_in_tree":
                node_id = resolve_ref(str(op.get("id") or ""))
                new_parent_id = resolve_parent(str(op.get("parentId") or "root"))
                index = int(op.get("index") or 0)
                node = find_node(doc.root, node_id)
                old_parent = find_parent(doc.root, node_id)
                new_parent = find_node(doc.root, new_parent_id)
                if not node or not old_parent or not new_parent or new_parent.type != "box":
                    raise ValueError("Invalid move_in_tree")
                old_parent.children = [c for c in old_parent.children if c.id != node_id]
                index = max(0, min(index, len(new_parent.children)))
                if isinstance(op.get("x"), (int, float)) and isinstance(op.get("y"), (int, float)):
                    node.x = float(op["x"])
                    node.y = float(op["y"])
                new_parent.children.insert(index, node)
            elif name == "update_image":
                node = find_node(doc.root, resolve_ref(str(op.get("id") or "")))
                if not node:
                    raise ValueError("Unknown node")
                patch = op.get("patch") if isinstance(op.get("patch"), dict) else {}
                if "imageSrc" in patch:
                    node.image_src = str(patch["imageSrc"])
                if "objectFit" in patch and patch["objectFit"] in ("cover", "contain"):
                    node.object_fit = patch["objectFit"]
            elif name == "update_node":
                node = find_node(doc.root, resolve_ref(str(op.get("id") or "")))
                if not node:
                    raise ValueError("Unknown node")
                patch = op.get("patch") if isinstance(op.get("patch"), dict) else {}
                if "level" in patch:
                    node.level = int(patch["level"])
                if "repeat" in patch and isinstance(patch["repeat"], dict):
                    node.repeat = patch["repeat"]  # type: ignore[assignment]
            elif name == "add_variable":
                name_v = str(op.get("name") or "").strip()
                label = str(op.get("label") or name_v).strip()
                var = VariableSchema.model_validate(
                    {
                        "id": counter.next("var"),
                        "name": name_v,
                        "label": label,
                        "type": op.get("type") or "text",
                        "sampleValue": op.get("sampleValue") or "",
                    }
                )
                doc.variables.append(var)
            elif name == "update_variable":
                var_id = str(op.get("id") or "")
                var = next((v for v in doc.variables if v.id == var_id), None)
                if not var:
                    raise ValueError("Unknown variable")
                patch = op.get("patch") if isinstance(op.get("patch"), dict) else {}
                data = var.model_dump(by_alias=True, mode="json")
                data.update(patch)
                idx = doc.variables.index(var)
                doc.variables[idx] = VariableSchema.model_validate(data)
            elif name == "remove_variable":
                var_id = str(op.get("id") or "")
                doc.variables = [v for v in doc.variables if v.id != var_id]
            elif name == "set_page_width":
                doc.page.w = float(op["w"])
                doc.root.w = float(op["w"])
            elif name == "set_page_count":
                n = int(op["n"])
                doc.page.h = doc.page.h  # page height unit unchanged; root grows
                doc.root.h = max(doc.root.h, n * doc.page.h)
            else:
                raise ValueError(f"Unsupported op {name}")
        except Exception as exc:  # noqa: BLE001 — collect per-op errors like the client
            errors.append(f"{name}: {exc}")

    return doc, errors, counter


def apply_ops_and_layout(
    document: DesignDocument,
    ops: list[dict[str, Any]],
    *,
    id_counter: AiIdCounter | None = None,
) -> tuple[DesignDocument, list[str], AiIdCounter]:
    doc, errors, counter = apply_design_ops(document, ops, id_counter=id_counter)
    return apply_full_layout(doc), errors, counter
