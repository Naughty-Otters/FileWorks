from __future__ import annotations

import json
import re
from typing import Any, Protocol

from app.core.config import get_settings
from app.engines.llm.engine import LLMEngine
from app.processing.template.runtime import used_variables
from app.processing.template.schema import DesignDocument, VariableSchema, VariableSchemaField

EXTRACT_PROMPT = (
    "Fill the target document template from the source markdown. "
    "Map source facts onto the named variables using the variable context and JSON schema. "
    "Do not invent facts; use empty strings or empty arrays when a value is absent. "
    "Keep currency, dates, and identifiers in the form they appear in the source when possible. "
    "For list variables, emit one object per distinct source row or line item."
)


class TemplateFillEngine(Protocol):
    def complete_structured(
        self,
        prompt: str,
        schema: dict[str, Any],
        *,
        purpose: str = "text",
    ) -> dict[str, Any]: ...


def extraction_schema(
    document: DesignDocument,
    *,
    document_name: str | None = None,
    document_description: str | None = None,
) -> dict[str, Any]:
    variables = document.variable_map()
    properties: dict[str, Any] = {
        name: _json_schema(variable) for name, variable in variables.items()
    }
    required = [name for name, variable in variables.items() if variable.required]
    aliases = _repeat_aliases(document)
    for path in used_variables(document):
        root = path.split(".", 1)[0]
        if root in aliases:
            continue
        properties.setdefault(
            root,
            {
                "type": "string",
                "description": f"Value for template placeholder {{{{ {path} }}}}",
            },
        )
    description = (document_description or "").strip() or (
        "Values extracted from the source document for the template."
    )
    if document_name and document_name.strip():
        description = f"{document_name.strip()}. {description}"
    return {
        "title": _schema_title(document_name),
        "description": description,
        "type": "object",
        "properties": properties,
        "required": required,
    }


def build_extraction_prompt(
    document: DesignDocument,
    source_markdown: str,
    *,
    document_name: str | None = None,
    document_description: str | None = None,
    schema: dict[str, Any] | None = None,
) -> str:
    schema = schema or extraction_schema(
        document,
        document_name=document_name,
        document_description=document_description,
    )
    target_lines = ["Target document:"]
    title = (document_name or "").strip() or "Untitled template"
    target_lines.append(f"Name: {title}")
    purpose = (document_description or "").strip()
    if purpose:
        target_lines.append(f"Purpose: {purpose}")
    layout = _layout_context(document)
    if layout:
        target_lines.append("Layout placeholders:")
        target_lines.extend(layout)

    variable_lines = ["Variable context:"]
    catalog = _variable_context_lines(document)
    variable_lines.extend(catalog or ["- (none declared; infer from placeholders)"])

    return "\n".join(
        [
            EXTRACT_PROMPT,
            "",
            "\n".join(target_lines),
            "",
            "\n".join(variable_lines),
            "",
            f"JSON schema:\n{json.dumps(schema, ensure_ascii=False, indent=2)}",
            "",
            f"Source markdown:\n{source_markdown}",
        ]
    )


def _schema_title(name: str | None) -> str:
    words = re.findall(r"[A-Za-z0-9]+", name or "")
    slug = "".join(word[:1].upper() + word[1:] for word in words)
    if not slug:
        return "TemplateContext"
    if slug[0].isdigit():
        slug = f"Template{slug}"
    return f"{slug[:60]}Context"


def _repeat_aliases(document: DesignDocument) -> set[str]:
    return {
        node.repeat.as_.strip()
        for node in document.iter_nodes()
        if node.repeat is not None and node.repeat.as_.strip()
    }


def _layout_context(document: DesignDocument) -> list[str]:
    lines: list[str] = []
    for node in document.iter_nodes():
        if node.repeat:
            section = (node.label or "row").strip() or "row"
            lines.append(
                f"- Repeating section \"{section}\" iterates `{node.repeat.over}` as `{node.repeat.as_}`"
            )
        if node.type not in {"heading", "paragraph"}:
            continue
        text = (node.label or "").strip()
        if "{{" not in text:
            continue
        snippet = " / ".join(part.strip() for part in text.splitlines() if part.strip())
        if len(snippet) > 160:
            snippet = snippet[:157] + "..."
        lines.append(f"- {node.type}: {snippet}")
    return lines


def _variable_context_lines(document: DesignDocument) -> list[str]:
    aliases = _repeat_aliases(document)
    used = used_variables(document)
    lines: list[str] = []
    for variable in document.variables:
        lines.append(_variable_catalog_line(variable))
    declared = set(document.variable_map())
    extras = sorted(
        {
            path.split(".", 1)[0]
            for path in used
            if path.split(".", 1)[0] not in declared and path.split(".", 1)[0] not in aliases
        }
    )
    for name in extras:
        paths = sorted(path for path in used if path == name or path.startswith(f"{name}."))
        shown = ", ".join(f"{{{{ {path} }}}}" for path in paths[:4])
        lines.append(f"- `{name}` (string): used in the template as {shown}")
    return lines


def _variable_catalog_line(variable: VariableSchema) -> str:
    desc = (variable.label or variable.name).strip()
    line = f"- `{variable.name}` ({variable.type}): {desc}"
    if variable.type in {"list", "object"} and variable.item_schema:
        fields = "; ".join(_field_catalog(field) for field in variable.item_schema)
        line += f" Fields: {fields}."
    return line


def _field_catalog(field: VariableSchemaField) -> str:
    label = (field.label or field.name).strip()
    if label == field.name:
        return f"{field.name} ({field.type})"
    return f"{field.name} ({field.type}): {label}"


def _json_schema(variable: VariableSchema) -> dict[str, Any]:
    kind = {
        "list": "array",
        "text": "string",
        "currency": "string",
        "date": "string",
        "image": "string",
    }.get(variable.type, variable.type)
    result: dict[str, Any] = {"type": kind}
    description = _variable_schema_description(variable)
    if description:
        result["description"] = description
    if variable.type in {"object", "list"}:
        properties = {
            field.name: _field_json_schema(field) for field in variable.item_schema
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


def _variable_schema_description(variable: VariableSchema) -> str:
    parts: list[str] = []
    if variable.label.strip():
        parts.append(variable.label.strip())
    if variable.type == "list":
        parts.append("Repeatable rows from the source.")
        if variable.item_schema:
            parts.append("Each row has: " + ", ".join(_field_catalog(field) for field in variable.item_schema) + ".")
    elif variable.type == "object" and variable.item_schema:
        parts.append("Object fields: " + ", ".join(_field_catalog(field) for field in variable.item_schema) + ".")
    return " ".join(parts)


def _field_json_schema(field: VariableSchemaField) -> dict[str, Any]:
    result: dict[str, Any] = {
        "type": {
            "text": "string",
            "currency": "string",
            "date": "string",
            "image": "string",
        }.get(field.type, field.type)
    }
    if field.label.strip() and field.label.strip() != field.name:
        result["description"] = field.label.strip()
    return result


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
    engine: TemplateFillEngine | None = None,
    document_name: str | None = None,
    document_description: str | None = None,
) -> dict[str, Any]:
    schema = extraction_schema(
        document,
        document_name=document_name,
        document_description=document_description,
    )
    prompt = build_extraction_prompt(
        document,
        source_markdown,
        document_name=document_name,
        document_description=document_description,
        schema=schema,
    )
    value = (engine or LLMEngine(get_settings())).complete_structured(
        prompt,
        schema,
        purpose="template-fill",
    )
    _validate(value, schema)
    return value
