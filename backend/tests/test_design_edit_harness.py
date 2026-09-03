"""Harness tests for design-edit macros, last_column parenting, and simulate loop.

Covers today's create-path fixes: info rows must stack as siblings under a section
(not nest row-in-row at ~20px), scaffold injection, and expand → apply → layout.
"""

from __future__ import annotations

from app.processing.template.agent_tools import expand_agent_tools
from app.processing.template.design_edit import build_design_edit_prompt, run_design_edit
from app.processing.template.doc_ops import apply_ops_and_layout
from app.processing.template.layout_qa import assess_layout
from app.processing.template.schema import DesignDocument


def _blank(*, w: float = 794, h: float = 1123) -> DesignDocument:
    return DesignDocument.model_validate(
        {
            "version": 2,
            "pageSize": {"w": w, "h": h},
            "root": {
                "id": "root",
                "kind": "box",
                "label": "Document",
                "w": w,
                "h": h,
                "children": [],
            },
            "variables": [],
        }
    )


def _info_row_boxes(section) -> list:
    return [c for c in section.children if c.type == "box" and (c.label or "") == "Row"]


def test_unit_prompt_requires_last_column_for_info_rows() -> None:
    prompt = build_design_edit_prompt(_blank(), "Create a property flyer")
    assert "last_column" in prompt
    assert "nests a row inside" in prompt or "row-in-row" in prompt or "collapses widths" in prompt


def test_unit_expand_rewrites_ambiguous_info_row_parents() -> None:
    ops = expand_agent_tools(
        [
            {"tool": "scaffold_page", "gap": 20, "padding": 40},
            {"tool": "add_section", "title": "Property Specifications", "parentId": "root"},
            {
                "tool": "add_info_row",
                "parentId": "last_created_sibling",
                "label": "Living Area",
                "value": "{{ square_feet }}",
            },
            {
                "tool": "add_info_row",
                "parentId": "last_created",
                "label": "Listing Price",
                "value": "{{ listing_price }}",
            },
            {
                "tool": "add_info_row",
                "label": "Year Built",
                "value": "{{ year_built }}",
            },
        ],
        page_w=794,
    )
    row_box_parents = [
        op["parentId"]
        for op in ops
        if op.get("op") == "add_element" and op.get("kind") == "box" and op.get("parentId") != "root"
    ]
    # Section under root once; every info-row box under last_column.
    assert row_box_parents == ["last_column", "last_column", "last_column"]


def test_unit_doc_ops_last_column_skips_row_wrapper() -> None:
    """After an info row, last_created is the value paragraph; last_column is the section."""
    doc = _blank()
    ops = expand_agent_tools(
        [
            {"tool": "scaffold_page"},
            {"tool": "add_section", "title": "Specs", "parentId": "root"},
            {
                "tool": "add_info_row",
                "parentId": "last_column",
                "label": "Beds",
                "value": "4",
            },
            {
                "tool": "add_info_row",
                "parentId": "last_column",
                "label": "Baths",
                "value": "3",
            },
        ],
        page_w=794,
    )
    out, errors, _ = apply_ops_and_layout(doc, ops)
    assert errors == []
    section = out.root.children[0]
    rows = _info_row_boxes(section)
    assert len(rows) == 2
    assert all(r.children and all(c.type == "paragraph" for c in r.children) for r in rows)
    # No nested Row boxes (the regression from the property flyer).
    assert all(not any(c.type == "box" for c in r.children) for r in rows)
    assert all(r.w >= 100 for r in rows)


def test_integration_stacked_info_rows_survive_layout_qa() -> None:
    """Expand → apply → layout for a multi-field section (property-specs style)."""
    doc = _blank()
    tools = [
        {"tool": "scaffold_page", "gap": 20, "padding": 40},
        {
            "tool": "edit_variable",
            "action": "add",
            "name": "square_feet",
            "label": "Sq Ft",
            "type": "text",
            "sampleValue": "2,850 sq ft",
        },
        {
            "tool": "edit_variable",
            "action": "add",
            "name": "listing_price",
            "label": "Price",
            "type": "currency",
            "sampleValue": "$685,000",
        },
        {"tool": "add_section", "title": "Property Specifications", "parentId": "root"},
        # Deliberately wrong aliases — expand must rewrite to last_column.
        {
            "tool": "add_info_row",
            "parentId": "last_created_sibling",
            "label": "Living Area",
            "value": "{{ square_feet }}",
        },
        {
            "tool": "add_info_row",
            "parentId": "last_created",
            "label": "Listing Price",
            "value": "{{ listing_price }}",
        },
        {
            "tool": "add_info_row",
            "parentId": "last_created_sibling",
            "label": "Year Built",
            "value": "2019",
        },
    ]
    ops = expand_agent_tools(tools, page_w=794)
    out, errors, _ = apply_ops_and_layout(doc, ops)
    assert errors == []
    assert len(out.variables) == 2
    assert out.root.layout is not None
    assert out.root.layout.direction == "column"

    section = next(c for c in out.root.children if c.type == "box")
    headings = [c for c in section.children if c.type == "heading"]
    rows = _info_row_boxes(section)
    assert len(headings) == 1
    assert headings[0].label == "Property Specifications"
    assert len(rows) == 3
    assert {r.children[0].label for r in rows} == {
        "Living Area",
        "Listing Price",
        "Year Built",
    }
    # Full content width under padded root (794 - 80 ≈ 714), not ~20px collapse.
    assert all(r.w >= 400 for r in rows)
    issues = assess_layout(out)
    assert not any(i.get("code") == "narrow_section" for i in issues)


def test_integration_run_design_edit_rewrites_and_simulates_create() -> None:
    """Full run_design_edit with a mock LLM that emits the buggy parent aliases."""
    document = _blank()

    class Engine:
        def configured(self) -> bool:
            return True

        @property
        def init_error(self) -> str | None:
            return None

        def complete_structured(self, prompt: str, schema: dict, *, purpose: str) -> dict:
            assert purpose == "design-edit"
            assert "last_column" in prompt
            return {
                "reply": "Built property specs with stacked info rows.",
                "designBrief": {
                    "intent": "create",
                    "concept": "Property showing flyer with specs band.",
                    "bands": ["Header", "Property Specifications"],
                    "notes": "Use info rows under the specs section.",
                },
                "steps": [
                    {
                        "reasoning": "Declare variables before UI tokens.",
                        "summary": "Variables",
                        "tools": [
                            {
                                "tool": "edit_variable",
                                "action": "add",
                                "name": "property_title",
                                "label": "Title",
                                "type": "text",
                                "sampleValue": "742 Evergreen Terrace",
                            },
                            {
                                "tool": "edit_variable",
                                "action": "add",
                                "name": "listing_price",
                                "label": "Price",
                                "type": "currency",
                                "sampleValue": "$685,000",
                            },
                        ],
                    },
                    {
                        "reasoning": "Header identity band.",
                        "summary": "Header",
                        "tools": [
                            {
                                "tool": "add_section",
                                "title": "{{ property_title }}",
                                "parentId": "root",
                            }
                        ],
                    },
                    {
                        "reasoning": "Specs as label|value rows under one section.",
                        "summary": "Property Specifications",
                        "tools": [
                            {
                                "tool": "add_section",
                                "title": "Property Specifications",
                                "parentId": "root",
                            },
                            {
                                "tool": "add_info_row",
                                "parentId": "last_created_sibling",
                                "label": "Listing Price",
                                "value": "{{ listing_price }}",
                            },
                            {
                                "tool": "add_info_row",
                                "parentId": "last_created",
                                "label": "Living Area",
                                "value": "2,850 sq ft",
                            },
                        ],
                    },
                ],
            }

    result = run_design_edit(
        document,
        "Create a property showing flyer with specs",
        engine=Engine(),
    )
    assert result["designBrief"]["intent"] == "create"
    assert result["designBrief"]["bands"][0] == "Header"
    assert result["steps"][0]["summary"] == "Scaffold page spine"

    # Flatten expanded ops and re-apply to verify final tree shape the client will get.
    flat_ops: list[dict] = []
    for step in result["steps"]:
        flat_ops.extend(step.get("ops") or [])
    out, errors, _ = apply_ops_and_layout(document, flat_ops)
    assert errors == []
    sections = [c for c in out.root.children if c.type == "box"]
    assert len(sections) >= 2
    specs = next(
        s
        for s in sections
        if any(
            c.type == "heading" and c.label == "Property Specifications" for c in s.children
        )
    )
    rows = _info_row_boxes(specs)
    assert len(rows) == 2
    assert all(not any(c.type == "box" for c in r.children) for r in rows)
    assert all(r.w >= 400 for r in rows)

    # Expanded ops for info-row boxes must use last_column (rewrite from mock aliases).
    info_row_parents = [
        op["parentId"]
        for step in result["steps"]
        for op in step.get("ops") or []
        if op.get("op") == "add_element"
        and op.get("kind") == "box"
        and op.get("parentId") not in {"root"}
    ]
    # Section boxes use last_created / root; row boxes must be last_column.
    assert "last_column" in info_row_parents
    assert "last_created_sibling" not in [
        op["parentId"]
        for step in result["steps"]
        for op in step.get("ops") or []
        if op.get("op") == "add_element" and op.get("kind") == "box"
    ]


def test_integration_two_col_still_uses_sibling_for_columns() -> None:
    """add_two_col legitimately uses last_created_sibling for the right column."""
    doc = _blank()
    ops = expand_agent_tools(
        [
            {"tool": "scaffold_page"},
            {"tool": "add_two_col", "parentId": "root"},
        ],
        page_w=794,
    )
    assert any(
        op.get("op") == "add_element" and op.get("parentId") == "last_created_sibling" for op in ops
    )
    out, errors, _ = apply_ops_and_layout(doc, ops)
    assert errors == []
    row = out.root.children[0]
    assert row.layout and row.layout.direction == "row"
    assert len(row.children) == 2
    assert all(c.layout and c.layout.direction == "column" for c in row.children)
