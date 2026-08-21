from __future__ import annotations

import copy
import json
import re
from collections.abc import Mapping
from typing import Any

from app.processing.template.schema import DesignDocument, DesignNode, VariableSchema

TOKEN_RE = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*)\s*\}\}")


def used_variables(document: DesignDocument) -> set[str]:
    names: set[str] = set()
    for node in document.iter_nodes():
        for text in (node.label, node.image_src or ""):
            names.update(match.group(1) for match in TOKEN_RE.finditer(text))
        if node.repeat:
            names.add(node.repeat.over.strip().removeprefix("{{").removesuffix("}}").strip())
    return names


def template_analysis(document: DesignDocument) -> tuple[bool, list[str]]:
    used = used_variables(document)
    repeaters = [node for node in document.iter_nodes() if node.repeat is not None]
    warnings: list[str] = []
    declared = set(document.variable_map())
    undeclared = sorted({name.split(".", 1)[0] for name in used} - declared)
    if undeclared:
        warnings.append(f"Undeclared variables used: {', '.join(undeclared)}")
    is_static = not declared and not used and not repeaters
    return is_static, warnings


def _parse_default(variable: VariableSchema) -> Any:
    raw = (variable.sample_value or "").strip()
    if variable.type == "list":
        if not raw:
            return []
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, list) else []
        except json.JSONDecodeError:
            return []
    if variable.type == "object":
        if not raw:
            return {}
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    if raw:
        return raw
    if variable.type == "number":
        return "0"
    if variable.type == "currency":
        return "$0.00"
    if variable.type in {"text", "date"}:
        return (variable.label or variable.name or "").strip()
    return ""


def default_context(document: DesignDocument) -> dict[str, Any]:
    """Build a render context from each variable's default / sample value."""
    return {name: _parse_default(variable) for name, variable in document.variable_map().items()}


def _is_empty_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict, tuple)):
        return len(value) == 0
    return False


def coalesce_context(
    defaults: Mapping[str, Any],
    extracted: Mapping[str, Any] | None = None,
    overrides: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Merge layers field-wise: non-empty override > non-empty extracted > default.

    Empty AI / override values fall through so sample defaults still fill gaps.
    """
    extracted = extracted or {}
    overrides = overrides or {}
    keys = set(defaults) | set(extracted) | set(overrides)
    merged: dict[str, Any] = {}
    for key in keys:
        for layer in (overrides, extracted, defaults):
            if key in layer and not _is_empty_value(layer[key]):
                merged[key] = layer[key]
                break
        else:
            if key in overrides:
                merged[key] = overrides[key]
            elif key in extracted:
                merged[key] = extracted[key]
            else:
                merged[key] = defaults.get(key)
    return merged


def resolve_path(context: Mapping[str, Any], path: str) -> Any:
    """Resolve a dotted data path without attributes, calls, or expressions."""
    if not TOKEN_RE.fullmatch("{{" + path + "}}"):
        return None
    value: Any = context
    for part in path.split("."):
        if isinstance(value, Mapping):
            value = value.get(part)
        elif isinstance(value, (list, tuple)) and part.isdigit():
            index = int(part)
            value = value[index] if 0 <= index < len(value) else None
        else:
            return None
    return value


def interpolate(text: str | None, context: Mapping[str, Any]) -> str:
    if not text:
        return ""

    def replace(match: re.Match[str]) -> str:
        value = resolve_path(context, match.group(1))
        if value is None:
            return ""
        if isinstance(value, (dict, list, tuple)):
            return str(value)
        return str(value)

    return TOKEN_RE.sub(replace, text)


def expand_repeats(document: DesignDocument, context: Mapping[str, Any]) -> DesignDocument:
    def expand(nodes: list[DesignNode], scope: Mapping[str, Any]) -> list[DesignNode]:
        result: list[DesignNode] = []
        y_offset = 0.0
        for source in nodes:
            if source.repeat:
                over = source.repeat.over.strip().removeprefix("{{").removesuffix("}}").strip()
                values = resolve_path(scope, over)
                if not isinstance(values, (list, tuple)):
                    continue
                for index, item in enumerate(values):
                    local = dict(scope)
                    local[source.repeat.as_] = item
                    local["index"] = index
                    node = source.model_copy(deep=True)
                    node.id = f"{source.id}-{index + 1}"
                    node.y += y_offset + index * (node.h + 8)
                    node.repeat = None
                    node.label = interpolate(node.label, local)
                    node.image_src = interpolate(node.image_src, local) or None
                    node.children = expand(node.children, local)
                    result.append(node)
                if values:
                    y_offset += (len(values) - 1) * (source.h + 8)
                continue
            node = source.model_copy(deep=True)
            node.y += y_offset
            node.label = interpolate(node.label, scope)
            node.image_src = interpolate(node.image_src, scope) or None
            node.children = expand(node.children, scope)
            result.append(node)
        return result

    filled = copy.deepcopy(document)
    roots = expand([filled.root], context)
    if roots:
        filled.root = roots[0]
    return filled


def auto_layout(document: DesignDocument) -> tuple[DesignDocument, list[str]]:
    """Fill missing coordinates and clamp nodes to their page bounds."""
    laid_out = document.model_copy(deep=True)
    page = laid_out.page
    warnings: list[str] = []

    def place(nodes: list[DesignNode]) -> None:
        for node in nodes:
            node.w = min(node.w, page.w)
            node.h = min(node.h, page.h)
            node.x = max(0, min(node.x, page.w - node.w))
            if node.y + node.h > page.h:
                warnings.append(f"Node {node.id} exceeded page bounds and was clamped")
            node.y = max(0, min(node.y, page.h - node.h))
            place(node.children)

    place([laid_out.root])
    return laid_out, warnings
