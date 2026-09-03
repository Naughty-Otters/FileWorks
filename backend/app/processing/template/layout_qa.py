"""Layout quality assessment + deterministic polish ops for the design agent."""

from __future__ import annotations

from typing import Any

from app.processing.template.schema import DesignDocument, DesignNode


def assess_layout(document: DesignDocument) -> list[dict[str, str]]:
    """Return structured layout issues (id + code + hint)."""
    issues: list[dict[str, str]] = []
    page_w = float(document.page.w)
    target_w = max(100.0, page_w - 48.0)
    root = document.root

    if root.layout is None and len(root.children) >= 2:
        issues.append(
            {
                "id": "root",
                "code": "root_freeform",
                "hint": "Enable column auto-layout on root with stretch + padding ~40.",
            }
        )

    for child in root.children:
        # Only section boxes should span the page — leaf text/images can be narrower.
        if child.type != "box":
            continue
        if child.w < target_w * 0.72:
            issues.append(
                {
                    "id": child.id,
                    "code": "narrow_section",
                    "hint": f"Widen to ~{int(target_w)}px (page content width).",
                }
            )

    def walk(node: DesignNode) -> None:
        if node.type == "box" and node.layout is not None and node.id != "root":
            style = node.style
            if style.border_style not in (None, "none") and style.border_width > 0:
                if (style.background_color or "").lower() in {"#ffffff", "#fff", "white"}:
                    issues.append(
                        {
                            "id": node.id,
                            "code": "card_chrome",
                            "hint": "Clear border/fill on structural wrappers (invisible chrome).",
                        }
                    )
            if node.layout.align == "center" and len(node.children) >= 2:
                issues.append(
                    {
                        "id": node.id,
                        "code": "center_align_frame",
                        "hint": "Use layout.align=stretch for section frames; center text via style.align.",
                    }
                )
        for child in node.children:
            walk(child)

    walk(root)

    # Overlaps among freeform siblings
    def overlaps(node: DesignNode) -> None:
        if node.layout is None and len(node.children) >= 2:
            kids = node.children
            for i, a in enumerate(kids):
                for b in kids[i + 1 :]:
                    if not (
                        a.x + a.w <= b.x
                        or b.x + b.w <= a.x
                        or a.y + a.h <= b.y
                        or b.y + b.h <= a.y
                    ):
                        issues.append(
                            {
                                "id": node.id,
                                "code": "overlap",
                                "hint": f"Children {a.id} and {b.id} overlap — enable column layout on parent.",
                            }
                        )
        for child in node.children:
            overlaps(child)

    overlaps(root)
    return issues


def polish_ops_for_issues(
    document: DesignDocument,
    issues: list[dict[str, str]],
) -> list[dict[str, Any]]:
    """Deterministic DesignOps that fix common issues (stable + ai_* ids)."""
    ops: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    page_w = float(document.page.w)
    target_w = max(100.0, page_w - 48.0)

    for issue in issues:
        key = (issue["code"], issue["id"])
        if key in seen:
            continue
        seen.add(key)
        node_id = issue["id"]
        code = issue["code"]

        if code == "root_freeform":
            ops.append({"op": "toggle_auto_layout", "id": "root", "enabled": True})
            ops.append(
                {
                    "op": "update_layout_props",
                    "id": "root",
                    "patch": {
                        "direction": "column",
                        "gap": 24,
                        "padding": 40,
                        "align": "stretch",
                        "justify": "start",
                    },
                }
            )
        elif code == "narrow_section":
            node = _find(document.root, node_id)
            if node:
                ops.append(
                    {
                        "op": "resize_node",
                        "id": node_id,
                        "w": target_w,
                        "h": max(node.h, 48),
                    }
                )
        elif code == "card_chrome":
            ops.append(
                {
                    "op": "update_style",
                    "id": node_id,
                    "patch": {
                        "backgroundColor": "transparent",
                        "borderStyle": "none",
                        "borderWidth": 0,
                    },
                }
            )
        elif code == "center_align_frame":
            ops.append(
                {
                    "op": "update_layout_props",
                    "id": node_id,
                    "patch": {"align": "stretch"},
                }
            )
        elif code == "overlap":
            ops.append({"op": "toggle_auto_layout", "id": node_id, "enabled": True})
            ops.append(
                {
                    "op": "update_layout_props",
                    "id": node_id,
                    "patch": {
                        "direction": "column",
                        "gap": 12,
                        "padding": 16,
                        "align": "stretch",
                    },
                }
            )

    return ops


def _find(root: DesignNode, node_id: str) -> DesignNode | None:
    if root.id == node_id:
        return root
    for child in root.children:
        found = _find(child, node_id)
        if found:
            return found
    return None


def format_issues(issues: list[dict[str, str]]) -> str:
    if not issues:
        return "No layout issues detected."
    lines = ["Layout QA issues after simulating your plan:"]
    for issue in issues:
        lines.append(f"- [{issue['code']}] id={issue['id']}: {issue['hint']}")
    return "\n".join(lines)
