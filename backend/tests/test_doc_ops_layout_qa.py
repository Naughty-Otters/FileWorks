from __future__ import annotations

from app.processing.template.doc_ops import AiIdCounter, apply_design_ops, apply_ops_and_layout
from app.processing.template.layout_qa import assess_layout, polish_ops_for_issues
from app.processing.template.schema import DesignDocument


def _blank() -> DesignDocument:
    return DesignDocument.model_validate(
        {
            "version": 2,
            "pageSize": {"w": 850, "h": 1100},
            "root": {
                "id": "root",
                "kind": "box",
                "label": "Document",
                "w": 850,
                "h": 1100,
                "children": [],
            },
            "variables": [],
        }
    )


def test_ai_ids_are_deterministic_and_independent_of_vars() -> None:
    counter = AiIdCounter()
    assert counter.next("var") == "ai_var_1"
    assert counter.next("box") == "ai_box_1"
    assert counter.next("heading") == "ai_heading_2"


def test_apply_ops_creates_ai_ids_and_polish_widens() -> None:
    doc = _blank()
    ops = [
        {"op": "add_element", "kind": "box", "parentId": "root"},
        {"op": "add_element", "kind": "heading", "parentId": "root"},
    ]
    laid, errors, _ = apply_ops_and_layout(doc, ops)
    assert errors == []
    assert [c.id for c in laid.root.children] == ["ai_box_1", "ai_heading_2"]
    issues = assess_layout(laid)
    assert any(i["code"] == "root_freeform" for i in issues)
    polish = polish_ops_for_issues(laid, issues)
    assert any(op["op"] == "toggle_auto_layout" and op["id"] == "root" for op in polish)
    fixed, _, _ = apply_ops_and_layout(laid, polish)
    remaining = assess_layout(fixed)
    assert not any(i["code"] == "root_freeform" for i in remaining)


def test_apply_design_ops_last_created_nesting() -> None:
    doc = _blank()
    ops = [
        {"op": "add_element", "kind": "box", "parentId": "root"},
        {"op": "toggle_auto_layout", "id": "last_created", "enabled": True},
        {"op": "add_element", "kind": "heading", "parentId": "last_created"},
        {"op": "update_label", "id": "last_created", "label": "Hello"},
    ]
    out, errors, _ = apply_design_ops(doc, ops)
    assert errors == []
    assert len(out.root.children) == 1
    assert out.root.children[0].children[0].label == "Hello"


def test_apply_design_ops_last_column_walks_past_row() -> None:
    """last_column must resolve to the section column, not the info-row wrapper."""
    doc = _blank()
    ops = [
        {"op": "toggle_auto_layout", "id": "root", "enabled": True},
        {
            "op": "update_layout_props",
            "id": "root",
            "patch": {"direction": "column", "gap": 20, "padding": 40},
        },
        {"op": "add_element", "kind": "box", "parentId": "root"},
        {"op": "toggle_auto_layout", "id": "last_created", "enabled": True},
        {
            "op": "update_layout_props",
            "id": "last_created",
            "patch": {"direction": "column", "gap": 12, "padding": 0},
        },
        {"op": "update_label", "id": "last_created", "label": "Specs"},
        {"op": "add_element", "kind": "heading", "parentId": "last_created"},
        # Row 1
        {"op": "add_element", "kind": "box", "parentId": "last_column"},
        {"op": "toggle_auto_layout", "id": "last_created", "enabled": True},
        {
            "op": "update_layout_props",
            "id": "last_created",
            "patch": {"direction": "row", "gap": 0, "padding": 0},
        },
        {"op": "update_label", "id": "last_created", "label": "Row"},
        {"op": "add_element", "kind": "paragraph", "parentId": "last_created"},
        {"op": "update_label", "id": "last_created", "label": "A"},
        {"op": "add_element", "kind": "paragraph", "parentId": "last_created_sibling"},
        {"op": "update_label", "id": "last_created", "label": "1"},
        # Row 2 via last_column (must not nest under row 1)
        {"op": "add_element", "kind": "box", "parentId": "last_column"},
        {"op": "update_label", "id": "last_created", "label": "Row"},
        {"op": "add_element", "kind": "paragraph", "parentId": "last_created"},
        {"op": "update_label", "id": "last_created", "label": "B"},
    ]
    out, errors, _ = apply_design_ops(doc, ops)
    assert errors == []
    section = out.root.children[0]
    rows = [c for c in section.children if c.type == "box"]
    assert len(rows) == 2
    assert all(not any(c.type == "box" for c in r.children) for r in rows)


def test_apply_design_ops_covers_mutations_and_variables() -> None:
    doc = _blank()
    ops = [
        {"op": "add_element", "kind": "box", "parentId": "root"},
        {"op": "update_box", "id": "last_created", "box": {"x": 1, "y": 2, "w": 100, "h": 50}},
        {"op": "move_node", "id": "last_created", "x": 8, "y": 9},
        {"op": "resize_node", "id": "last_created", "w": 120, "h": 60},
        {"op": "update_level", "id": "last_created", "level": 2},
        {"op": "add_element", "kind": "heading", "parentId": "last_created"},
        {
            "op": "move_in_tree",
            "id": "last_created",
            "parentId": "root",
            "index": 0,
            "x": 3,
            "y": 4,
        },
        {"op": "add_element", "kind": "image", "parentId": "root"},
        {
            "op": "update_image",
            "id": "last_created",
            "patch": {"imageSrc": "https://x.test/a.png", "objectFit": "contain"},
        },
        {
            "op": "update_node",
            "id": "last_created",
            "patch": {"level": 1, "repeat": {"over": "items", "as": "row"}},
        },
        {
            "op": "add_variable",
            "name": "title",
            "label": "Title",
            "type": "text",
            "sampleValue": "Hi",
        },
    ]
    mid, mid_errors, _ = apply_design_ops(doc, ops)
    assert mid_errors == []
    var_id = mid.variables[0].id
    more = [
        {"op": "update_variable", "id": var_id, "patch": {"label": "Doc title"}},
        {"op": "set_page_width", "w": 900},
        {"op": "set_page_count", "n": 2},
        {"op": "remove_variable", "id": var_id},
        {"op": "not_a_real_op"},
        {"op": "remove_element", "id": "missing"},
    ]
    out, errors, counter = apply_design_ops(mid, more)
    assert out.page.w == 900
    assert out.root.w == 900
    assert out.root.h >= 2 * out.page.h
    assert out.variables == []
    assert any("Unsupported op" in e for e in errors)
    assert any("remove_element" in e for e in errors)
    assert counter.next("box").startswith("ai_box_")


def test_layout_qa_polish_and_format_issues() -> None:
    from app.processing.template.layout_qa import format_issues, polish_ops_for_issues

    doc = _blank()
    doc.root.children = []
    # Force freeform + card chrome + narrow via assess after adding styled box
    ops = [
        {"op": "add_element", "kind": "box", "parentId": "root"},
        {
            "op": "update_style",
            "id": "last_created",
            "patch": {
                "backgroundColor": "#ffffff",
                "borderStyle": "solid",
                "borderWidth": 1,
            },
        },
        {"op": "resize_node", "id": "last_created", "w": 40, "h": 40},
    ]
    laid, _, _ = apply_ops_and_layout(doc, ops)
    issues = assess_layout(laid)
    # Inject polish codes that assess may not always emit so branches stay covered.
    issues = [
        *issues,
        {"code": "card_chrome", "id": "ai_box_1", "hint": "drop card chrome"},
        {"code": "center_align_frame", "id": "ai_box_1", "hint": "stretch"},
        {"code": "overlap", "id": "root", "hint": "overlap"},
        {"code": "narrow_section", "id": "ai_box_1", "hint": "widen"},
    ]
    polish = polish_ops_for_issues(laid, issues)
    assert any(op["op"] == "update_style" for op in polish)
    assert any(op.get("patch", {}).get("align") == "stretch" for op in polish if op["op"] == "update_layout_props")
    assert "Layout QA issues" in format_issues(issues)
    assert format_issues([]) == "No layout issues detected."
