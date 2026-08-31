"""JSON Schema for design-edit structured LLM output."""

from __future__ import annotations

from typing import Any

_OP_SCHEMA: dict[str, Any] = {
    "oneOf": [
        {
            "type": "object",
            "properties": {"op": {"const": "select"}, "id": {"type": "string"}},
            "required": ["op", "id"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "add_element"},
                "kind": {"type": "string", "enum": ["box", "heading", "paragraph", "image"]},
                "parentId": {"type": "string"},
                "x": {"type": "number"},
                "y": {"type": "number"},
            },
            "required": ["op", "kind", "parentId"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {"op": {"const": "remove_element"}, "id": {"type": "string"}},
            "required": ["op", "id"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "update_label"},
                "id": {"type": "string"},
                "label": {"type": "string"},
            },
            "required": ["op", "id", "label"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "update_style"},
                "id": {"type": "string"},
                "patch": {"type": "object", "additionalProperties": True},
            },
            "required": ["op", "id", "patch"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "update_level"},
                "id": {"type": "string"},
                "level": {"type": "integer", "minimum": 1, "maximum": 6},
            },
            "required": ["op", "id", "level"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "move_node"},
                "id": {"type": "string"},
                "x": {"type": "number"},
                "y": {"type": "number"},
            },
            "required": ["op", "id", "x", "y"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "resize_node"},
                "id": {"type": "string"},
                "w": {"type": "number"},
                "h": {"type": "number"},
            },
            "required": ["op", "id", "w", "h"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "update_box"},
                "id": {"type": "string"},
                "box": {
                    "type": "object",
                    "properties": {
                        "x": {"type": "number"},
                        "y": {"type": "number"},
                        "w": {"type": "number"},
                        "h": {"type": "number"},
                    },
                    "required": ["x", "y", "w", "h"],
                },
            },
            "required": ["op", "id", "box"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "update_layout_props"},
                "id": {"type": "string"},
                "patch": {"type": "object", "additionalProperties": True},
            },
            "required": ["op", "id", "patch"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "toggle_auto_layout"},
                "id": {"type": "string"},
                "enabled": {"type": "boolean"},
            },
            "required": ["op", "id", "enabled"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "move_in_tree"},
                "id": {"type": "string"},
                "parentId": {"type": "string"},
                "index": {"type": "integer", "minimum": 0},
                "x": {"type": "number"},
                "y": {"type": "number"},
            },
            "required": ["op", "id", "parentId", "index"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "update_image"},
                "id": {"type": "string"},
                "patch": {"type": "object", "additionalProperties": True},
            },
            "required": ["op", "id", "patch"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "update_node"},
                "id": {"type": "string"},
                "patch": {"type": "object", "additionalProperties": True},
            },
            "required": ["op", "id", "patch"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "add_variable"},
                "name": {"type": "string"},
                "label": {"type": "string"},
                "type": {
                    "type": "string",
                    "enum": ["text", "number", "currency", "date", "image", "list", "object"],
                },
                "sampleValue": {"type": "string"},
            },
            "required": ["op", "name", "label"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {
                "op": {"const": "update_variable"},
                "id": {"type": "string"},
                "patch": {"type": "object", "additionalProperties": True},
            },
            "required": ["op", "id", "patch"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {"op": {"const": "remove_variable"}, "id": {"type": "string"}},
            "required": ["op", "id"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {"op": {"const": "set_page_width"}, "w": {"type": "number", "minimum": 100}},
            "required": ["op", "w"],
            "additionalProperties": False,
        },
        {
            "type": "object",
            "properties": {"op": {"const": "set_page_count"}, "n": {"type": "integer", "minimum": 1}},
            "required": ["op", "n"],
            "additionalProperties": False,
        },
    ]
}


def design_edit_schema() -> dict[str, Any]:
    return {
        "title": "DesignEditResponse",
        "type": "object",
        "properties": {
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
                            "description": "Why this step — design rationale, not a restatement of the user request.",
                        },
                        "summary": {
                            "type": "string",
                            "description": "Short user-facing label for this step.",
                        },
                        "ops": {
                            "type": "array",
                            "items": _OP_SCHEMA,
                        },
                    },
                    "required": ["reasoning", "summary", "ops"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["reply", "steps"],
        "additionalProperties": False,
    }
