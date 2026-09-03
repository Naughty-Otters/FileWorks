"""JSON Schema for design-edit structured LLM output.

The model emits a small set of agent tools (see ``agent_tools``). Those compile
into low-level DesignOps for the client executor.
"""

from __future__ import annotations

import re
from typing import Any

from app.processing.template.agent_tools import AGENT_TOOLS, agent_tool_item_schema

# Low-level ops remain for expand/normalize and legacy aliases.
ALLOWED_OPS: tuple[str, ...] = (
    "select",
    "add_element",
    "remove_element",
    "update_label",
    "update_style",
    "update_level",
    "move_node",
    "resize_node",
    "update_box",
    "update_layout_props",
    "toggle_auto_layout",
    "move_in_tree",
    "update_image",
    "update_node",
    "add_variable",
    "update_variable",
    "remove_variable",
    "set_page_width",
    "set_page_count",
)

OP_ALIASES: dict[str, str] = {
    "addelement": "add_element",
    "addElement": "add_element",
    "create_element": "add_element",
    "createElement": "add_element",
    "insert_element": "add_element",
    "removeelement": "remove_element",
    "removeElement": "remove_element",
    "delete_element": "remove_element",
    "deleteElement": "remove_element",
    "updatelabel": "update_label",
    "updateLabel": "update_label",
    "set_label": "update_label",
    "setLabel": "update_label",
    "updatestyle": "update_style",
    "updateStyle": "update_style",
    "set_style": "update_style",
    "updatelevel": "update_level",
    "updateLevel": "update_level",
    "movenode": "move_node",
    "moveNode": "move_node",
    "resizenode": "resize_node",
    "resizeNode": "resize_node",
    "updatebox": "update_box",
    "updateBox": "update_box",
    "updatelayoutprops": "update_layout_props",
    "updateLayoutProps": "update_layout_props",
    "update_layout": "update_layout_props",
    "toggleautolayout": "toggle_auto_layout",
    "toggleAutoLayout": "toggle_auto_layout",
    "set_auto_layout": "toggle_auto_layout",
    "moveintree": "move_in_tree",
    "moveInTree": "move_in_tree",
    "reparent": "move_in_tree",
    "updateimage": "update_image",
    "updateImage": "update_image",
    "updatenode": "update_node",
    "updateNode": "update_node",
    "addvariable": "add_variable",
    "addVariable": "add_variable",
    "create_variable": "add_variable",
    "updatevariable": "update_variable",
    "updateVariable": "update_variable",
    "removevariable": "remove_variable",
    "removeVariable": "remove_variable",
    "setpagewidth": "set_page_width",
    "setPageWidth": "set_page_width",
    "setpagecount": "set_page_count",
    "setPageCount": "set_page_count",
}


def normalize_op_name(raw: Any) -> str | None:
    if not isinstance(raw, str):
        return None
    name = raw.strip()
    if not name:
        return None
    if name in ALLOWED_OPS:
        return name
    aliased = OP_ALIASES.get(name) or OP_ALIASES.get(name.replace("-", "_"))
    if aliased:
        return aliased
    snake = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).replace("-", "_").lower()
    if snake in ALLOWED_OPS:
        return snake
    return None


def normalize_ops(ops: list[Any]) -> list[dict[str, Any]]:
    """Drop/repair low-level ops (used after tool expansion)."""
    cleaned: list[dict[str, Any]] = []
    for item in ops:
        if not isinstance(item, dict):
            continue
        op_name = normalize_op_name(item.get("op"))
        if not op_name:
            continue
        fixed = {**item, "op": op_name}
        cleaned.append(fixed)
    return cleaned


def design_edit_schema() -> dict[str, Any]:
    """LLM sees agent tools only — not the full DesignOp surface."""
    return {
        "title": "DesignEditResponse",
        "type": "object",
        "properties": {
            "designBrief": {
                "type": "object",
                "description": (
                    "Required design plan BEFORE tools. Like a coding agent's architecture "
                    "plan: concept, ordered page bands, and intent."
                ),
                "properties": {
                    "intent": {
                        "type": "string",
                        "enum": ["create", "update", "adjust", "clarify"],
                    },
                    "concept": {
                        "type": "string",
                        "description": "One sentence: document type + visual idea.",
                    },
                    "bands": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Ordered vertical page bands top→bottom on create. "
                            "On adjust/update, list mutation targets instead "
                            '(e.g. ["Reorder Specs rows", "Delete footer note"]).'
                        ),
                    },
                    "notes": {
                        "type": "string",
                        "description": "Spacing, hierarchy, and what to avoid.",
                    },
                },
                "required": ["intent", "concept", "bands"],
            },
            "reply": {
                "type": "string",
                "description": "Brief natural-language summary of what changed or what you need from the user.",
            },
            "steps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "reasoning": {
                            "type": "string",
                            "minLength": 1,
                            "description": (
                                "Design rationale for this band/step — placement and hierarchy, "
                                "not a restatement of the user request."
                            ),
                        },
                        "summary": {
                            "type": "string",
                            "description": "Short user-facing label (often the band name).",
                        },
                        "tools": {
                            "type": "array",
                            "description": (
                                f"Agent tools ({', '.join(AGENT_TOOLS)}). "
                                "Creates: scaffold_page → add_section / add_info_row band-by-band. "
                                "Adjust/update: edit_node update/remove with real nodeIndex ids."
                            ),
                            "items": agent_tool_item_schema(),
                        },
                    },
                    "required": ["reasoning", "summary", "tools"],
                },
            },
        },
        "required": ["designBrief", "reply", "steps"],
    }
