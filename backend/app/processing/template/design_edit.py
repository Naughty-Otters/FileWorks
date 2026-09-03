from __future__ import annotations

import json
from typing import Any, Protocol

from app.core.config import get_settings
from app.engines.llm.design_agent import get_design_agent_engine
from app.processing.template.agent_tools import AGENT_TOOLS, expand_agent_tools, normalize_tools
from app.processing.template.doc_ops import AiIdCounter, apply_ops_and_layout
from app.processing.template.layout_qa import assess_layout, format_issues, polish_ops_for_issues
from app.processing.template.ops_schema import design_edit_schema, normalize_ops
from app.processing.template.prompts.design_edit_prompt import SYSTEM_PROMPT
from app.processing.template.schema import DesignDocument, DesignNode


class DesignEditEngine(Protocol):
    def configured(self) -> bool: ...

    @property
    def init_error(self) -> str | None: ...

    def complete_structured(
        self,
        prompt: str,
        schema: dict[str, Any],
        *,
        purpose: str = "text",
    ) -> dict[str, Any]: ...


def _system_prompt() -> str:
    """Return the embedded system prompt (Python module — immune to *.md dockerignore)."""
    text = (SYSTEM_PROMPT or "").strip()
    if not text:
        raise RuntimeError("Design-edit system prompt is empty")
    return text


def _truncate(text: str, limit: int = 80) -> str:
    cleaned = " ".join(text.split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 1] + "…"


def _style_summary(node: DesignNode) -> dict[str, Any] | None:
    style = node.style
    if style is None:
        return None
    patch: dict[str, Any] = {}
    if style.font_size is not None:
        patch["fontSize"] = style.font_size
    if style.align:
        patch["align"] = style.align
    if style.bold:
        patch["bold"] = True
    if style.color and style.color not in {"#000000", "#000", "black"}:
        patch["color"] = style.color
    bg = (style.background_color or "").lower()
    if bg and bg not in {"transparent", "#ffffff", "#fff", "white"}:
        patch["backgroundColor"] = style.background_color
    if style.border_style and style.border_style != "none" and style.border_width:
        patch["borderStyle"] = style.border_style
        patch["borderWidth"] = style.border_width
    return patch or None


def _layout_summary(node: DesignNode) -> dict[str, Any] | str:
    if node.layout is None:
        return "freeform"
    layout = node.layout
    return {
        "direction": layout.direction,
        "gap": layout.gap,
        "padding": layout.padding,
        "align": layout.align,
        "justify": layout.justify,
    }


def _layout_mode(node: DesignNode) -> str:
    if node.layout is None:
        return "freeform"
    return str(node.layout.direction or "column")


def _boxes_overlap(a: DesignNode, b: DesignNode) -> bool:
    return not (
        a.x + a.w <= b.x or b.x + b.w <= a.x or a.y + a.h <= b.y or b.y + b.h <= a.y
    )


def _summarize_node(node: DesignNode, depth: int = 0, *, max_depth: int = 4) -> dict[str, Any]:
    summary: dict[str, Any] = {
        "id": node.id,
        "kind": node.type,
        "label": _truncate(node.label or "", 100),
        "layoutMode": _layout_mode(node),
        "layout": _layout_summary(node),
        "box": {"x": node.x, "y": node.y, "w": node.w, "h": node.h},
        "childCount": len(node.children),
        "childOrder": [c.id for c in node.children],
    }
    if node.level:
        summary["level"] = node.level
    style = _style_summary(node)
    if style:
        summary["style"] = style
    if depth < max_depth and node.children:
        summary["children"] = [
            _summarize_node(child, depth + 1, max_depth=max_depth) for child in node.children
        ]
    return summary


def _flat_index(
    node: DesignNode,
    out: list[dict[str, Any]] | None = None,
    *,
    parent_id: str | None = None,
) -> list[dict[str, Any]]:
    items = out if out is not None else []
    items.append(
        {
            "id": node.id,
            "kind": node.type,
            "label": _truncate(node.label or "", 60),
            "parentId": parent_id,
            "layoutMode": _layout_mode(node),
            "box": {"x": node.x, "y": node.y, "w": node.w, "h": node.h},
            "children": len(node.children),
        }
    )
    for child in node.children:
        _flat_index(child, items, parent_id=node.id)
    return items


def _layout_map(root: DesignNode) -> dict[str, Any]:
    """Sibling frames + overlap warnings so the model can reason about stacking."""
    containers: list[dict[str, Any]] = []
    overlaps: list[dict[str, Any]] = []

    def visit(node: DesignNode) -> None:
        if node.children:
            containers.append(
                {
                    "id": node.id,
                    "label": _truncate(node.label or "", 40),
                    "layoutMode": _layout_mode(node),
                    "note": (
                        "auto-layout stacks children by childOrder; ignore freeform x/y"
                        if node.layout is not None
                        else "FREEFORM: children use absolute x/y — identical boxes overlap"
                    ),
                    "children": [
                        {
                            "id": child.id,
                            "kind": child.type,
                            "label": _truncate(child.label or "", 40),
                            "box": {
                                "x": child.x,
                                "y": child.y,
                                "w": child.w,
                                "h": child.h,
                            },
                            "layoutMode": _layout_mode(child),
                        }
                        for child in node.children
                    ],
                }
            )
            if node.layout is None and len(node.children) >= 2:
                for i, a in enumerate(node.children):
                    for b in node.children[i + 1 :]:
                        if _boxes_overlap(a, b):
                            overlaps.append(
                                {
                                    "parentId": node.id,
                                    "a": a.id,
                                    "b": b.id,
                                    "hint": (
                                        "These siblings overlap. Enable column auto-layout "
                                        "on the parent, or move them apart."
                                    ),
                                }
                            )
        for child in node.children:
            visit(child)

    visit(root)
    return {
        "howToRead": (
            "layoutMode=column|row means the solver places children in order. "
            "layoutMode=freeform means each child's box x/y is absolute. "
            "Never place two freeform siblings at the same x/y. "
            "Prefer scaffold_page + add_section over freeform siblings on root."
        ),
        "containers": containers,
        "overlaps": overlaps,
    }


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


def _starter_recipe(message: str) -> str | None:
    """Inject a compact golden structure from a matching built-in starter."""
    text = message.lower()
    mapping = [
        (("invoice", "bill"), "invoice"),
        (("receipt",), "receipt"),
        (("nda", "non-disclosure", "non disclosure"), "nda"),
        (("offer letter", "offer_letter"), "offer_letter"),
        (("proposal",), "business_proposal"),
        (("agenda", "meeting"), "meeting_agenda"),
        (("paystub", "pay stub", "payslip"), "paystub"),
        (("rental", "lease"), "rental"),
        (("timesheet",), "timesheet"),
    ]
    starter_id = None
    for keys, sid in mapping:
        if any(k in text for k in keys):
            starter_id = sid
            break
    if not starter_id:
        return None
    try:
        from app.processing.template.starters import load_starter_document

        starter = load_starter_document(starter_id)
    except Exception:  # noqa: BLE001 — starters may be missing in some deploys
        return None

    def outline(node: DesignNode, depth: int = 0) -> list[str]:
        if depth > 3:
            return []
        pad = "  " * depth
        layout = _layout_mode(node)
        line = f"{pad}- {node.type} “{_truncate(node.label or '', 40)}” layout={layout} {int(node.w)}×{int(node.h)}"
        lines = [line]
        for child in node.children[:8]:
            lines.extend(outline(child, depth + 1))
        if len(node.children) > 8:
            lines.append(f"{pad}  … +{len(node.children) - 8} more")
        return lines

    vars_line = ", ".join(f"{v.name}:{v.type}" for v in starter.variables[:12]) or "(none)"
    return (
        f"Golden starter reference `{starter_id}` (match this structure quality; do not copy ids):\n"
        f"page {int(starter.page.w)}×{int(starter.page.h)}; variables: {vars_line}\n"
        + "\n".join(outline(starter.root))
        + "\nUse scaffold_page first, then add_section / add_info_row / edit_node."
    )


def build_design_edit_prompt(
    document: DesignDocument,
    message: str,
    *,
    selection_id: str | None = None,
    conversation: list[dict[str, str]] | None = None,
    observation: str | None = None,
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
        "layoutMap": _layout_map(document.root),
        "nodeIndex": _flat_index(document.root),
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
        _system_prompt(),
        "",
        "Current document:",
        json.dumps(doc_context, indent=2),
        "",
    ]

    recipe = _starter_recipe(message)
    if recipe:
        lines.extend([recipe, ""])

    if conversation:
        lines.append("Conversation:")
        for turn in conversation[-8:]:
            role = turn.get("role", "user")
            content = (turn.get("content") or "").strip()
            if content:
                lines.append(f"{role}: {content}")
        lines.append("")

    if observation:
        lines.extend(
            [
                "OBSERVATION (from simulating your previous plan on a server copy):",
                observation,
                "Emit repair tools only — fix the listed issues. Prefer scaffold_page / layout patches.",
                "",
            ]
        )

    lines.extend(
        [
            "User request:",
            message.strip(),
            "",
            "Respond with JSON: designBrief (intent/concept/bands), reply, steps.",
            "Workflow: designBrief → scaffold_page + variables → one step per band "
            "(add_section / add_info_row). Do not dump freeform leaves on root.",
            f"Page size is {document.page.w}×{document.page.h}; content width ≈ {max(100, int(document.page.w) - 48)}.",
            f"Allowed tools only: {', '.join(AGENT_TOOLS)}.",
        ]
    )
    return "\n".join(lines)


def _normalize_steps(
    steps: list[Any],
    *,
    page_w: float,
) -> list[dict[str, Any]]:
    normalized_steps: list[dict[str, Any]] = []
    for step in steps:
        if not isinstance(step, dict):
            continue
        reasoning = str(step.get("reasoning") or "").strip()
        summary = str(step.get("summary") or "").strip()
        tools_raw = step.get("tools")
        ops_raw = step.get("ops")
        if not reasoning:
            raise RuntimeError("Each step must include non-empty reasoning")
        if not summary:
            summary = "Edit step"
        if isinstance(tools_raw, list) and tools_raw:
            tools = normalize_tools(tools_raw)
            ops = normalize_ops(expand_agent_tools(tools, page_w=page_w))
        elif isinstance(ops_raw, list):
            tools = []
            ops = normalize_ops(ops_raw)
        else:
            tools = []
            ops = []
        normalized_steps.append(
            {
                "reasoning": reasoning,
                "summary": summary,
                "tools": tools,
                "ops": ops,
            }
        )
    return normalized_steps


def _flatten_ops(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = []
    for step in steps:
        ops.extend(step.get("ops") or [])
    return ops


def _normalize_design_brief(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {
            "intent": "update",
            "concept": "Edit the current document.",
            "bands": [],
            "notes": "",
        }
    intent = str(raw.get("intent") or "update").strip().lower()
    if intent not in {"create", "update", "adjust", "clarify"}:
        intent = "update"
    bands_raw = raw.get("bands")
    bands = [str(b).strip() for b in bands_raw if str(b).strip()] if isinstance(bands_raw, list) else []
    return {
        "intent": intent,
        "concept": str(raw.get("concept") or "").strip() or "Refine the document layout.",
        "bands": bands,
        "notes": str(raw.get("notes") or "").strip(),
    }


def _is_create_like(message: str, brief: dict[str, Any], document: DesignDocument) -> bool:
    if brief.get("intent") == "create":
        return True
    text = message.lower()
    if any(k in text for k in ("create", "build", "make me", "new template", "design a", "generate a", "from scratch")):
        return True
    return len(document.root.children) == 0 and brief.get("intent") != "clarify"


def _ensure_scaffold_first(steps: list[dict[str, Any]], *, page_w: float) -> list[dict[str, Any]]:
    """If a create plan forgot scaffold_page, prepend it (Cursor-like spine first)."""
    flat_tools: list[dict[str, Any]] = []
    for step in steps:
        flat_tools.extend(step.get("tools") or [])
    if any(t.get("tool") == "scaffold_page" for t in flat_tools):
        return steps
    if not any(
        t.get("tool") in {"add_section", "add_info_row", "add_two_col", "edit_node"} for t in flat_tools
    ):
        return steps
    scaffold_tools = [{"tool": "scaffold_page", "gap": 24, "padding": 40}]
    scaffold_step = {
        "reasoning": (
            "Page spine first: root column auto-layout so every band stacks cleanly "
            "(injected because the plan started building UI without scaffold_page)."
        ),
        "summary": "Scaffold page spine",
        "tools": scaffold_tools,
        "ops": normalize_ops(expand_agent_tools(scaffold_tools, page_w=page_w)),
    }
    return [scaffold_step, *steps]


def run_design_edit(
    document: DesignDocument,
    message: str,
    *,
    selection_id: str | None = None,
    conversation: list[dict[str, str]] | None = None,
    engine: DesignEditEngine | None = None,
) -> dict[str, Any]:
    """Plan → simulate → polish → optional repair (Cursor-like observe loop)."""
    llm: DesignEditEngine = engine or get_design_agent_engine(get_settings())
    if not llm.configured():
        raise RuntimeError(llm.init_error or "Design Agent is not configured")

    page_w = float(document.page.w)
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
    steps_raw = result.get("steps")
    brief = _normalize_design_brief(result.get("designBrief") or result.get("design_brief"))
    if not reply:
        raise RuntimeError("Design edit returned empty reply")
    if not isinstance(steps_raw, list):
        raise RuntimeError("Design edit returned invalid steps")

    if brief["intent"] == "clarify":
        return {"reply": reply, "designBrief": brief, "steps": []}

    steps = _normalize_steps(steps_raw, page_w=page_w)
    if _is_create_like(message, brief, document):
        steps = _ensure_scaffold_first(steps, page_w=page_w)

    all_ops = _flatten_ops(steps)
    counter = AiIdCounter()
    simulated = document
    sim_errors: list[str] = []
    issues: list[dict[str, str]] = []
    try:
        simulated, sim_errors, counter = apply_ops_and_layout(document, all_ops, id_counter=counter)
        issues = assess_layout(simulated)
    except Exception as exc:  # noqa: BLE001 — never fail the user turn on simulator bugs
        sim_errors = [f"simulate: {exc}"]

    try:
        polish = polish_ops_for_issues(simulated, issues)
        if polish:
            steps.append(
                {
                    "reasoning": (
                        "Server layout QA applied deterministic polish so sections span the page, "
                        "root uses column auto-layout, and structural chrome stays invisible."
                    ),
                    "summary": "Polish layout",
                    "tools": [],
                    "ops": polish,
                }
            )
            simulated, _, counter = apply_ops_and_layout(simulated, polish, id_counter=counter)
            issues = assess_layout(simulated)
    except Exception as exc:  # noqa: BLE001
        sim_errors.append(f"polish: {exc}")

    # Optional second LLM pass. Disabled by default — a second long Gemini call
    # routinely exceeds the Next.js rewrite proxy and surfaces as socket hang up.
    settings = get_settings()
    if issues and bool(getattr(settings, "design_agent_repair_pass", False)):
        observation = format_issues(issues)
        if sim_errors:
            observation += "\nApply errors:\n- " + "\n- ".join(sim_errors[:8])
        try:
            repair_prompt = build_design_edit_prompt(
                simulated,
                message,
                selection_id=selection_id,
                conversation=conversation,
                observation=observation,
            )
            repair = llm.complete_structured(repair_prompt, schema, purpose="design-edit")
            if isinstance(repair, dict):
                repair_steps_raw = repair.get("steps")
                if isinstance(repair_steps_raw, list) and repair_steps_raw:
                    repair_steps = _normalize_steps(repair_steps_raw, page_w=page_w)
                    repair_steps = [s for s in repair_steps if s.get("ops") or s.get("tools")]
                    if repair_steps:
                        steps.extend(repair_steps)
                        repair_reply = str(repair.get("reply") or "").strip()
                        if repair_reply:
                            reply = f"{reply} {repair_reply}".strip()
        except Exception:  # noqa: BLE001 — return the primary plan rather than 500
            pass

    return {"reply": reply, "designBrief": brief, "steps": steps}
