from __future__ import annotations

import json
import re
from typing import Any

from app.core.config import get_settings
from app.engines.llm.engine import LLMEngine
from app.processing.template.runtime import used_variables
from app.processing.template.schema import DesignDocument, VariableSchema


def extraction_schema(document: DesignDocument) -> dict[str, Any]:
    variables = document.variable_map()
    properties: dict[str, Any] = {
        name: _json_schema(variable) for name, variable in variables.items()
    }
    required = [name for name, variable in variables.items() if variable.required]
    for path in used_variables(document):
        root = path.split(".", 1)[0]
        properties.setdefault(root, {"type": "string"})
    return {"type": "object", "properties": properties, "required": required}


def _json_schema(variable: VariableSchema) -> dict[str, Any]:
    kind = {
        "list": "array",
        "text": "string",
        "currency": "string",
        "date": "string",
        "image": "string",
    }.get(variable.type, variable.type)
    result: dict[str, Any] = {"type": kind}
    if variable.label:
        result["description"] = variable.label
    if variable.type in {"object", "list"}:
        properties = {
            field.name: {
                "type": {
                    "text": "string",
                    "currency": "string",
                    "date": "string",
                    "image": "string",
                }.get(field.type, field.type)
            }
            for field in variable.item_schema
        }
        object_schema: dict[str, Any] = {
            "type": "object",
            "properties": properties,
            "required": [field.name for field in variable.item_schema if field.required],
        }
        if variable.type == "list":
            result["items"] = object_schema
        else:
            result.update(object_schema)
    return result


def _parse_json(raw: str) -> dict[str, Any]:
    cleaned = raw.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", cleaned, flags=re.IGNORECASE | re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    try:
        value = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise ValueError("Template extraction returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise TypeError("Template extraction must return a JSON object")
    return value


def _validate(value: Any, schema: dict[str, Any], path: str = "$") -> None:
    kind = schema.get("type")
    expected = {
        "object": dict,
        "array": list,
        "string": str,
        "number": (int, float),
        "boolean": bool,
    }.get(kind)
    if expected and (not isinstance(value, expected) or kind == "number" and isinstance(value, bool)):
        raise ValueError(f"{path} must be {kind}")
    if kind == "object":
        for name in schema.get("required", []):
            if name not in value:
                raise ValueError(f"{path}.{name} is required")
        for name, child in schema.get("properties", {}).items():
            if name in value:
                _validate(value[name], child, f"{path}.{name}")
    elif kind == "array" and schema.get("items"):
        for index, item in enumerate(value):
            _validate(item, schema["items"], f"{path}[{index}]")


def extract_template_context(
    document: DesignDocument,
    source_markdown: str,
    *,
    engine: LLMEngine | None = None,
) -> dict[str, Any]:
    schema = extraction_schema(document)
    prompt = (
        "Extract values from the source for a document template. Return JSON only, with no "
        "markdown fence. Do not invent facts; use empty strings or empty arrays when absent.\n\n"
        f"JSON schema:\n{json.dumps(schema, ensure_ascii=False)}\n\n"
        f"Source markdown:\n{source_markdown}"
    )
    raw = (engine or LLMEngine(get_settings())).complete_text(prompt, purpose="template-fill")
    value = _parse_json(raw)
    _validate(value, schema)
    return value
