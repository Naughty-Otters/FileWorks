"""Agent-facing design tools (few, rich params) that expand into DesignOps.

The LLM only sees these tools. The client executor still applies low-level DesignOps.
"""

from __future__ import annotations

from typing import Any

AGENT_TOOLS: tuple[str, ...] = (
    "edit_node",
    "edit_variable",
    "edit_page",
    "select",
    "scaffold_page",
    "add_section",
    "add_info_row",
    "add_two_col",
)

_NODE_ACTIONS = ("add", "update", "remove")
_VARIABLE_ACTIONS = ("add", "update", "remove")
_ELEMENT_KINDS = ("box", "heading", "paragraph", "image")
_VARIABLE_TYPES = ("text", "number", "currency", "date", "image", "list", "object")

_INVISIBLE = {
    "backgroundColor": "transparent",
    "borderStyle": "none",
    "borderWidth": 0,
}

_AGENT_TOOL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "description": (
        "One agent tool call. Prefer scaffold_page / add_section / add_info_row for structure, "
        "then edit_node for fine tweaks. "
        "For adjust/update: edit_node update (label/style/layout/box/parentId+index) or "
        "edit_node remove (delete by real id). "
        f"tool must be one of: {', '.join(AGENT_TOOLS)}."
    ),
    "properties": {
        "tool": {
            "type": "string",
            "enum": list(AGENT_TOOLS),
            "description": "Agent tool name.",
        },
        "action": {
            "type": "string",
            "enum": ["add", "update", "remove"],
            "description": (
                "For edit_node / edit_variable. "
                "edit_node: add|update|remove — remove deletes the node (and descendants if box). "
                "update with parentId+index reorders/reparents; box.w/h resizes; layout patches auto-layout."
            ),
        },
        "id": {
            "type": "string",
            "description": (
                "Target node/variable id. For updates/removes use a real id from "
                "nodeIndex/selection — not last_created unless you just added in this step."
            ),
        },
        "parentId": {
            "type": "string",
            "description": (
                "Parent box id, or last_created / last_created_sibling / last_column. "
                "For stacking add_info_row under a section, use last_column (never "
                "last_created_sibling after a row — that nests rows). "
                "For reorder/reparent (edit_node update), use the real parent id from nodeIndex."
            ),
        },
        "kind": {
            "type": "string",
            "enum": list(_ELEMENT_KINDS),
            "description": "Element kind when action=add (edit_node).",
        },
        "label": {"type": "string", "description": "Text content / display label."},
        "title": {
            "type": "string",
            "description": "Section title (add_section) or page scaffold label.",
        },
        "value": {
            "type": "string",
            "description": "Value text / token for add_info_row.",
        },
        "level": {"type": "integer", "minimum": 1, "maximum": 6},
        "index": {
            "type": "integer",
            "minimum": 0,
            "description": (
                "0-based sibling index under parentId when reparenting/reordering "
                "(edit_node update). Use nodeIndex.index from document context."
            ),
        },
        "style": {
            "type": "object",
            "additionalProperties": True,
            "description": "Typography/visual style patch (fontSize, align, bold, color, …).",
        },
        "layout": {
            "type": "object",
            "description": "Auto-layout config for boxes. Set enabled=false to clear auto-layout.",
            "properties": {
                "enabled": {"type": "boolean"},
                "direction": {"type": "string", "enum": ["row", "column"]},
                "gap": {"type": "number"},
                "padding": {"type": "number"},
                "align": {"type": "string", "enum": ["start", "center", "end", "stretch"]},
                "justify": {
                    "type": "string",
                    "enum": ["start", "center", "end", "space-between"],
                },
            },
        },
        "box": {
            "type": "object",
            "description": (
                "Geometry. For resize use w/h only (omit x/y under auto-layout parents). "
                "x/y only when the parent is freeform."
            ),
            "properties": {
                "x": {"type": "number"},
                "y": {"type": "number"},
                "w": {"type": "number"},
                "h": {"type": "number"},
            },
        },
        "image": {
            "type": "object",
            "properties": {
                "imageSrc": {"type": "string"},
                "objectFit": {"type": "string", "enum": ["cover", "contain"]},
            },
        },
        "repeat": {
            "type": "object",
            "properties": {
                "over": {"type": "string"},
                "as": {"type": "string"},
            },
        },
        "name": {"type": "string", "description": "Variable name (edit_variable add)."},
        "type": {
            "type": "string",
            "enum": list(_VARIABLE_TYPES),
            "description": "Variable type (edit_variable).",
        },
        "sampleValue": {"type": "string"},
        "width": {"type": "number", "minimum": 100, "description": "Page width (edit_page) or section width."},
        "pageCount": {"type": "integer", "minimum": 1, "description": "Page count (edit_page)."},
        "gap": {"type": "number", "description": "scaffold_page / section gap."},
        "padding": {"type": "number", "description": "scaffold_page / section padding."},
    },
    "required": ["tool"],
}


def agent_tool_item_schema() -> dict[str, Any]:
    return _AGENT_TOOL_SCHEMA


def normalize_tool_name(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    name = raw.strip()
    if name in AGENT_TOOLS:
        return name
    aliases = {
        "editnode": "edit_node",
        "editNode": "edit_node",
        "node": "edit_node",
        "mutate_node": "edit_node",
        "editvariable": "edit_variable",
        "editVariable": "edit_variable",
        "variable": "edit_variable",
        "editpage": "edit_page",
        "editPage": "edit_page",
        "page": "edit_page",
        "select_node": "select",
        "scaffoldpage": "scaffold_page",
        "scaffoldPage": "scaffold_page",
        "scaffold": "scaffold_page",
        "addsection": "add_section",
        "addSection": "add_section",
        "section": "add_section",
        "addinforow": "add_info_row",
        "addInfoRow": "add_info_row",
        "info_row": "add_info_row",
        "infoRow": "add_info_row",
        "addtwocol": "add_two_col",
        "addTwoCol": "add_two_col",
        "two_col": "add_two_col",
        "twoCol": "add_two_col",
    }
    return aliases.get(name) or aliases.get(name.replace("-", "_"))


def normalize_tools(tools: list[Any]) -> list[dict[str, Any]]:
    cleaned: list[dict[str, Any]] = []
    for item in tools:
        if not isinstance(item, dict):
            continue
        tool = normalize_tool_name(item.get("tool") or item.get("op"))
        if not tool:
            continue
        fixed = {k: v for k, v in item.items() if k not in {"tool", "op"}}
        fixed["tool"] = tool
        cleaned.append(fixed)
    return cleaned


def expand_agent_tools(
    tools: list[dict[str, Any]],
    *,
    page_w: float = 850.0,
) -> list[dict[str, Any]]:
    """Compile agent tools into low-level DesignOps for the client executor."""
    ops: list[dict[str, Any]] = []
    content_w = max(100.0, float(page_w) - 48.0)
    for tool in tools:
        name = tool.get("tool")
        if name == "select":
            ops.extend(_expand_select(tool))
        elif name == "edit_node":
            ops.extend(_expand_edit_node(tool))
        elif name == "edit_variable":
            ops.extend(_expand_edit_variable(tool))
        elif name == "edit_page":
            ops.extend(_expand_edit_page(tool))
        elif name == "scaffold_page":
            ops.extend(_expand_scaffold_page(tool))
        elif name == "add_section":
            ops.extend(_expand_add_section(tool, content_w=content_w))
        elif name == "add_info_row":
            ops.extend(_expand_add_info_row(tool, content_w=content_w))
        elif name == "add_two_col":
            ops.extend(_expand_add_two_col(tool, content_w=content_w))
    return ops


def _expand_scaffold_page(tool: dict[str, Any]) -> list[dict[str, Any]]:
    gap = tool.get("gap")
    padding = tool.get("padding")
    return [
        {"op": "toggle_auto_layout", "id": "root", "enabled": True},
        {
            "op": "update_layout_props",
            "id": "root",
            "patch": {
                "direction": "column",
                "gap": float(gap) if isinstance(gap, (int, float)) else 24,
                "padding": float(padding) if isinstance(padding, (int, float)) else 40,
                "align": "stretch",
                "justify": "start",
            },
        },
        {
            "op": "update_style",
            "id": "root",
            "patch": {"backgroundColor": "#ffffff", "borderStyle": "none", "borderWidth": 0},
        },
    ]


def _expand_add_section(tool: dict[str, Any], *, content_w: float) -> list[dict[str, Any]]:
    parent_id = str(tool.get("parentId") or "root")
    title = tool.get("title") or tool.get("label") or "Section"
    width = float(tool["width"]) if isinstance(tool.get("width"), (int, float)) else content_w
    gap = float(tool["gap"]) if isinstance(tool.get("gap"), (int, float)) else 12
    padding = float(tool["padding"]) if isinstance(tool.get("padding"), (int, float)) else 0
    ops: list[dict[str, Any]] = [
        {"op": "add_element", "kind": "box", "parentId": parent_id},
        {
            "op": "resize_node",
            "id": "last_created",
            "w": width,
            "h": 80,
        },
        {"op": "toggle_auto_layout", "id": "last_created", "enabled": True},
        {
            "op": "update_layout_props",
            "id": "last_created",
            "patch": {
                "direction": "column",
                "gap": gap,
                "padding": padding,
                "align": "stretch",
                "justify": "start",
            },
        },
        {"op": "update_style", "id": "last_created", "patch": dict(_INVISIBLE)},
        {"op": "update_label", "id": "last_created", "label": str(title)},
        {
            "op": "add_element",
            "kind": "heading",
            "parentId": "last_created",
        },
        {"op": "update_label", "id": "last_created", "label": str(title)},
        {"op": "update_level", "id": "last_created", "level": int(tool["level"]) if isinstance(tool.get("level"), int) else 2},
        {
            "op": "update_style",
            "id": "last_created",
            "patch": {"fontSize": 18, "bold": True, "color": "#0f172a"},
        },
    ]
    return ops


def _expand_add_info_row(tool: dict[str, Any], *, content_w: float) -> list[dict[str, Any]]:
    """Label|value row under the nearest column section (never nest row-in-row)."""
    raw_parent = str(tool.get("parentId") or "last_column").strip()
    # After a prior info row, last_created is a paragraph and last_created_sibling
    # is the ROW — nesting there collapses widths to ~20px. Always prefer column.
    if raw_parent in {
        "",
        "last_created",
        "last_created_sibling",
        "last_section",
        "last_column",
    }:
        parent_id = "last_column"
    else:
        parent_id = raw_parent
    label = str(tool.get("label") or "Label")
    value = str(tool.get("value") or tool.get("title") or "")
    width = float(tool["width"]) if isinstance(tool.get("width"), (int, float)) else content_w
    label_w = min(150.0, max(90.0, width * 0.35))
    value_w = max(70.0, width - label_w)
    return [
        {"op": "add_element", "kind": "box", "parentId": parent_id},
        {"op": "resize_node", "id": "last_created", "w": width, "h": 32},
        {"op": "toggle_auto_layout", "id": "last_created", "enabled": True},
        {
            "op": "update_layout_props",
            "id": "last_created",
            "patch": {
                "direction": "row",
                "gap": 0,
                "padding": 0,
                "align": "center",
                "justify": "space-between",
            },
        },
        {"op": "update_style", "id": "last_created", "patch": dict(_INVISIBLE)},
        {"op": "update_label", "id": "last_created", "label": "Row"},
        {"op": "add_element", "kind": "paragraph", "parentId": "last_created"},
        {"op": "resize_node", "id": "last_created", "w": label_w, "h": 28},
        {"op": "update_label", "id": "last_created", "label": label},
        {
            "op": "update_style",
            "id": "last_created",
            "patch": {"fontSize": 13, "color": "#64748b", "align": "left"},
        },
        {"op": "add_element", "kind": "paragraph", "parentId": "last_created_sibling"},
        {"op": "resize_node", "id": "last_created", "w": value_w, "h": 28},
        {"op": "update_label", "id": "last_created", "label": value},
        {
            "op": "update_style",
            "id": "last_created",
            "patch": {"fontSize": 13, "color": "#0f172a", "align": "right"},
        },
    ]


def _expand_add_two_col(tool: dict[str, Any], *, content_w: float) -> list[dict[str, Any]]:
    """Row with two equal stretch columns (invisible). last_created = right column."""
    parent_id = str(tool.get("parentId") or "root")
    width = float(tool["width"]) if isinstance(tool.get("width"), (int, float)) else content_w
    gap = float(tool["gap"]) if isinstance(tool.get("gap"), (int, float)) else 24
    col_w = max(80.0, (width - gap) / 2)
    return [
        {"op": "add_element", "kind": "box", "parentId": parent_id},
        {"op": "resize_node", "id": "last_created", "w": width, "h": 120},
        {"op": "toggle_auto_layout", "id": "last_created", "enabled": True},
        {
            "op": "update_layout_props",
            "id": "last_created",
            "patch": {
                "direction": "row",
                "gap": gap,
                "padding": 0,
                "align": "stretch",
                "justify": "start",
            },
        },
        {"op": "update_style", "id": "last_created", "patch": dict(_INVISIBLE)},
        {"op": "update_label", "id": "last_created", "label": "Two columns"},
        {"op": "add_element", "kind": "box", "parentId": "last_created"},
        {"op": "resize_node", "id": "last_created", "w": col_w, "h": 100},
        {"op": "toggle_auto_layout", "id": "last_created", "enabled": True},
        {
            "op": "update_layout_props",
            "id": "last_created",
            "patch": {
                "direction": "column",
                "gap": 8,
                "padding": 0,
                "align": "stretch",
                "justify": "start",
            },
        },
        {"op": "update_style", "id": "last_created", "patch": dict(_INVISIBLE)},
        {"op": "update_label", "id": "last_created", "label": "Left"},
        {"op": "add_element", "kind": "box", "parentId": "last_created_sibling"},
        {"op": "resize_node", "id": "last_created", "w": col_w, "h": 100},
        {"op": "toggle_auto_layout", "id": "last_created", "enabled": True},
        {
            "op": "update_layout_props",
            "id": "last_created",
            "patch": {
                "direction": "column",
                "gap": 8,
                "padding": 0,
                "align": "stretch",
                "justify": "start",
            },
        },
        {"op": "update_style", "id": "last_created", "patch": dict(_INVISIBLE)},
        {"op": "update_label", "id": "last_created", "label": "Right"},
    ]


def _target_id(tool: dict[str, Any], *, after_add: bool = False) -> str:
    raw = tool.get("id")
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return "last_created" if after_add else ""


def _expand_select(tool: dict[str, Any]) -> list[dict[str, Any]]:
    node_id = _target_id(tool)
    if not node_id:
        return []
    return [{"op": "select", "id": node_id}]


def _expand_edit_node(tool: dict[str, Any]) -> list[dict[str, Any]]:
    action = str(tool.get("action") or "update").strip().lower()
    if action not in _NODE_ACTIONS:
        action = "update"

    if action == "remove":
        node_id = _target_id(tool)
        return [{"op": "remove_element", "id": node_id}] if node_id else []

    ops: list[dict[str, Any]] = []
    created = False

    if action == "add":
        kind = tool.get("kind")
        parent_id = tool.get("parentId") or "root"
        if kind not in _ELEMENT_KINDS:
            return []
        add_op: dict[str, Any] = {
            "op": "add_element",
            "kind": kind,
            "parentId": str(parent_id),
        }
        box = tool.get("box") if isinstance(tool.get("box"), dict) else None
        if box is not None:
            if isinstance(box.get("x"), (int, float)):
                add_op["x"] = float(box["x"])
            if isinstance(box.get("y"), (int, float)):
                add_op["y"] = float(box["y"])
        ops.append(add_op)
        created = True

    node_id = _target_id(tool, after_add=created)
    if not node_id:
        return ops

    parent_id = tool.get("parentId")
    index = tool.get("index")
    if action == "update" and isinstance(parent_id, str) and parent_id.strip() and isinstance(index, int):
        move: dict[str, Any] = {
            "op": "move_in_tree",
            "id": node_id,
            "parentId": parent_id.strip(),
            "index": index,
        }
        box = tool.get("box") if isinstance(tool.get("box"), dict) else None
        if box and isinstance(box.get("x"), (int, float)) and isinstance(box.get("y"), (int, float)):
            move["x"] = float(box["x"])
            move["y"] = float(box["y"])
        ops.append(move)

    layout = tool.get("layout")
    if isinstance(layout, dict):
        enabled = layout.get("enabled")
        if enabled is False:
            ops.append({"op": "toggle_auto_layout", "id": node_id, "enabled": False})
        else:
            if enabled is True or any(
                key in layout for key in ("direction", "gap", "padding", "align", "justify")
            ):
                ops.append({"op": "toggle_auto_layout", "id": node_id, "enabled": True})
            patch = {
                key: layout[key]
                for key in ("direction", "gap", "padding", "align", "justify")
                if key in layout
            }
            if patch:
                ops.append({"op": "update_layout_props", "id": node_id, "patch": patch})

    if isinstance(tool.get("label"), str):
        ops.append({"op": "update_label", "id": node_id, "label": tool["label"]})

    if isinstance(tool.get("level"), int):
        ops.append({"op": "update_level", "id": node_id, "level": int(tool["level"])})

    style = tool.get("style")
    if isinstance(style, dict) and style:
        ops.append({"op": "update_style", "id": node_id, "patch": style})

    image = tool.get("image")
    if isinstance(image, dict) and image:
        ops.append({"op": "update_image", "id": node_id, "patch": image})

    repeat = tool.get("repeat")
    if isinstance(repeat, dict) and repeat.get("over"):
        ops.append(
            {
                "op": "update_node",
                "id": node_id,
                "patch": {
                    "repeat": {
                        "over": str(repeat["over"]),
                        "as": str(repeat.get("as") or "item"),
                    }
                },
            }
        )

    box = tool.get("box") if isinstance(tool.get("box"), dict) else None
    if box and action == "add":
        # add_element only accepts x/y; apply size (and any leftover xy) afterward.
        has_xy = isinstance(box.get("x"), (int, float)) and isinstance(box.get("y"), (int, float))
        has_wh = isinstance(box.get("w"), (int, float)) and isinstance(box.get("h"), (int, float))
        if has_xy and has_wh:
            ops.append(
                {
                    "op": "update_box",
                    "id": node_id,
                    "box": {
                        "x": float(box["x"]),
                        "y": float(box["y"]),
                        "w": float(box["w"]),
                        "h": float(box["h"]),
                    },
                }
            )
        else:
            if has_wh:
                ops.append(
                    {
                        "op": "resize_node",
                        "id": node_id,
                        "w": float(box["w"]),
                        "h": float(box["h"]),
                    }
                )
            # x/y already applied on add_element when present

    if box and action == "update":
        has_xy = isinstance(box.get("x"), (int, float)) and isinstance(box.get("y"), (int, float))
        has_wh = isinstance(box.get("w"), (int, float)) and isinstance(box.get("h"), (int, float))
        if has_xy and has_wh:
            ops.append(
                {
                    "op": "update_box",
                    "id": node_id,
                    "box": {
                        "x": float(box["x"]),
                        "y": float(box["y"]),
                        "w": float(box["w"]),
                        "h": float(box["h"]),
                    },
                }
            )
        else:
            if has_xy and not (isinstance(parent_id, str) and isinstance(index, int)):
                ops.append({"op": "move_node", "id": node_id, "x": float(box["x"]), "y": float(box["y"])})
            if has_wh:
                ops.append({"op": "resize_node", "id": node_id, "w": float(box["w"]), "h": float(box["h"])})

    return ops


def _expand_edit_variable(tool: dict[str, Any]) -> list[dict[str, Any]]:
    action = str(tool.get("action") or "update").strip().lower()
    if action not in _VARIABLE_ACTIONS:
        action = "update"

    if action == "add":
        name = tool.get("name")
        label = tool.get("label")
        if not isinstance(name, str) or not name.strip():
            return []
        if not isinstance(label, str) or not label.strip():
            label = name
        op: dict[str, Any] = {
            "op": "add_variable",
            "name": name.strip(),
            "label": str(label).strip(),
        }
        var_type = tool.get("type")
        if var_type in _VARIABLE_TYPES:
            op["type"] = var_type
        if isinstance(tool.get("sampleValue"), str):
            op["sampleValue"] = tool["sampleValue"]
        return [op]

    var_id = _target_id(tool)
    if not var_id:
        return []
    if action == "remove":
        return [{"op": "remove_variable", "id": var_id}]

    patch: dict[str, Any] = {}
    for key in ("name", "label", "type", "sampleValue"):
        if key in tool and tool[key] is not None:
            patch[key] = tool[key]
    if not patch:
        return []
    return [{"op": "update_variable", "id": var_id, "patch": patch}]


def _expand_edit_page(tool: dict[str, Any]) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = []
    width = tool.get("width")
    if isinstance(width, (int, float)) and width >= 100:
        ops.append({"op": "set_page_width", "w": float(width)})
    page_count = tool.get("pageCount")
    if isinstance(page_count, int) and page_count >= 1:
        ops.append({"op": "set_page_count", "n": page_count})
    return ops
