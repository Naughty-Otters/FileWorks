from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Protocol

from app.core.config import get_settings
from app.engines.llm.engine import LLMEngine
from app.processing.template.ops_schema import design_edit_schema
from app.processing.template.schema import DesignDocument, DesignNode

_PROMPT_PATH = Path(__file__).resolve().parent / "prompts" / "design_edit.md"
_SYSTEM_PROMPT = _PROMPT_PATH.read_text(encoding="utf-8").strip()


class DesignEditEngine(Protocol):
    def complete_structured(
        self,
        prompt: str,
        schema: dict[str, Any],
        *,
        purpose: str = "text",
    ) -> dict[str, Any]: ...


def _truncate(text: str, limit: int = 80) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1] + "…"


def _summarize_node(node: DesignNode, depth: int = 0) -> dict[str, Any]:
    layout = "auto" if node.layout is not None else "freeform"
    summary: dict[str, Any] = {
        "id": node.id,
        "kind": node.type,
        "label": _truncate(node.label or ""),
        "layout": layout,
        "childCount": len(node.children),
    }
    if node.level:
        summary["level"] = node.level
    if depth < 2 and node.children:
        summary["children"] = [_summarize_node(child, depth + 1) for child in node.children]
    return summary


def _node_json(node: DesignNode) -> dict[str, Any]:
    return node.model_dump(by_alias=True, mode="json", exclude_none=True)


def _find_node(node: DesignNode, node_id: str) -> DesignNode | None:
    if node.id == node_id:
        return node
    for child in node.children:
        found = _find_node(child, node_id)
        if found:
            return found
    return None


def _breadcrumb(document: DesignDocument, node_id: str) -> list[str]:
    path: list[str] = []

    def walk(node: DesignNode, trail: list[str]) -> bool:
        current = [*trail, f"{node.type}:{node.id}"]
        if node.id == node_id:
            path.extend(current)
            return True
        for child in node.children:
            if walk(child, current):
                return True
        return False

    walk(document.root, [])
    return path


def build_design_edit_prompt(
    document: DesignDocument,
    message: str,
    *,
    selection_id: str | None = None,
    conversation: list[dict[str, str]] | None = None,
) -> str:
    variables = [
        {
            "id": v.id,
            "name": v.name,
            "label": v.label,
            "type": v.type,
            "sampleValue": v.sample_value,
        }
        for v in document.variables
    ]
    doc_context: dict[str, Any] = {
        "pageSize": {"w": document.page.w, "h": document.page.h},
        "variables": variables,
        "tree": _summarize_node(document.root),
    }
    if selection_id:
        selected = _find_node(document.root, selection_id)
        if selected:
            doc_context["selection"] = {
                "id": selection_id,
                "breadcrumb": _breadcrumb(document, selection_id),
                "node": _node_json(selected),
            }

    lines = [
        _SYSTEM_PROMPT,
        "",
        "Current document:",
        json.dumps(doc_context, indent=2),
        "",
    ]

    if conversation:
        lines.append("Conversation:")
        for turn in conversation[-8:]:
            role = turn.get("role", "user")
            content = (turn.get("content") or "").strip()
            if content:
                lines.append(f"{role}: {content}")
        lines.append("")

    lines.extend(
        [
            "User request:",
            message.strip(),
            "",
            "Respond with a JSON object matching the schema: reply, steps (each with reasoning, summary, ops).",
        ]
    )
    return "\n".join(lines)


def run_design_edit(
    document: DesignDocument,
    message: str,
    *,
    selection_id: str | None = None,
    conversation: list[dict[str, str]] | None = None,
    engine: DesignEditEngine | None = None,
) -> dict[str, Any]:
    llm = engine or LLMEngine(get_settings())
    if not getattr(llm, "configured", lambda: True)():
        raise RuntimeError(getattr(llm, "init_error", None) or "LLM is not configured")
    prompt = build_design_edit_prompt(
        document,
        message,
        selection_id=selection_id,
        conversation=conversation,
    )
    schema = design_edit_schema()
    result = llm.complete_structured(prompt, schema, purpose="design-edit")
    if not isinstance(result, dict):
        raise RuntimeError("Design edit returned invalid response")
    reply = str(result.get("reply") or "").strip()
    steps = result.get("steps")
    if not reply:
        raise RuntimeError("Design edit returned empty reply")
    if not isinstance(steps, list):
        raise RuntimeError("Design edit returned invalid steps")
    normalized_steps = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        reasoning = str(step.get("reasoning") or "").strip()
        summary = str(step.get("summary") or "").strip()
        ops = step.get("ops")
        if not reasoning:
            raise RuntimeError("Each step must include non-empty reasoning")
        if not summary:
            summary = "Edit step"
        if not isinstance(ops, list):
            ops = []
        normalized_steps.append({"reasoning": reasoning, "summary": summary, "ops": ops})
    return {"reply": reply, "steps": normalized_steps}
