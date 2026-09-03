from __future__ import annotations

from app.processing.template.agent_tools import expand_agent_tools, normalize_tools


def test_expand_info_row_uses_last_column_not_sibling() -> None:
    ops = expand_agent_tools(
        [
            {"tool": "add_section", "title": "Meta", "parentId": "root"},
            {
                "tool": "add_info_row",
                "parentId": "last_created_sibling",
                "label": "Date",
                "value": "{{ d }}",
            },
            {
                "tool": "add_info_row",
                "parentId": "last_created",
                "label": "Number",
                "value": "{{ n }}",
            },
        ],
        page_w=850,
    )
    row_parents = [op["parentId"] for op in ops if op.get("op") == "add_element" and op.get("kind") == "box"]
    # Section box under root, then two info-row boxes under last_column (not nested).
    assert row_parents[0] == "root"
    assert row_parents[1] == "last_column"
    assert row_parents[2] == "last_column"


def test_expand_scaffold_and_section() -> None:
    ops = expand_agent_tools(
        [
            {"tool": "scaffold_page"},
            {"tool": "add_section", "title": "Bill To"},
            {
                "tool": "add_info_row",
                "parentId": "last_created",
                "label": "Date",
                "value": "{{ invoice_date }}",
            },
        ],
        page_w=850,
    )
    assert ops[0]["op"] == "toggle_auto_layout"
    assert ops[0]["id"] == "root"
    assert any(op["op"] == "resize_node" and op.get("w") == 802.0 for op in ops)
    assert any(op.get("op") == "update_layout_props" and op.get("patch", {}).get("direction") == "row" for op in ops)


def test_expand_edit_node_add_applies_box_size() -> None:
    ops = expand_agent_tools(
        [
            {
                "tool": "edit_node",
                "action": "add",
                "kind": "box",
                "parentId": "root",
                "box": {"w": 802, "h": 120},
                "layout": {"enabled": True, "direction": "column", "align": "stretch"},
            }
        ]
    )
    assert [op["op"] for op in ops] == [
        "add_element",
        "toggle_auto_layout",
        "update_layout_props",
        "resize_node",
    ]
    assert ops[-1] == {"op": "resize_node", "id": "last_created", "w": 802.0, "h": 120.0}


def test_expand_edit_node_add_compiles_full_config() -> None:
    ops = expand_agent_tools(
        [
            {
                "tool": "edit_variable",
                "action": "add",
                "name": "document_title",
                "label": "Title",
                "type": "text",
                "sampleValue": "Invoice",
            },
            {
                "tool": "edit_node",
                "action": "add",
                "kind": "box",
                "parentId": "root",
                "layout": {
                    "enabled": True,
                    "direction": "column",
                    "gap": 8,
                    "padding": 24,
                    "align": "center",
                },
            },
            {
                "tool": "edit_node",
                "action": "add",
                "kind": "heading",
                "parentId": "last_created",
                "label": "{{ document_title }}",
                "level": 1,
                "style": {"fontSize": 32, "align": "center", "bold": True},
            },
        ]
    )
    assert [op["op"] for op in ops] == [
        "add_variable",
        "add_element",
        "toggle_auto_layout",
        "update_layout_props",
        "add_element",
        "update_label",
        "update_level",
        "update_style",
    ]
    assert ops[0]["name"] == "document_title"
    assert ops[4]["parentId"] == "last_created"
    assert ops[5]["id"] == "last_created"


def test_expand_edit_node_update_and_page() -> None:
    ops = expand_agent_tools(
        [
            {
                "tool": "edit_node",
                "action": "update",
                "id": "title",
                "style": {"align": "center"},
                "label": "Bill",
            },
            {"tool": "edit_page", "width": 794, "pageCount": 2},
            {"tool": "select", "id": "title"},
        ]
    )
    assert [op["op"] for op in ops] == [
        "update_label",
        "update_style",
        "set_page_width",
        "set_page_count",
        "select",
    ]


def test_normalize_tools_aliases() -> None:
    cleaned = normalize_tools(
        [
            {"tool": "editNode", "action": "add", "kind": "box", "parentId": "root"},
            {"op": "edit_variable", "action": "add", "name": "x", "label": "X"},
            {"tool": "nope"},
        ]
    )
    assert [item["tool"] for item in cleaned] == ["edit_node", "edit_variable"]


def test_expand_edit_node_remove_move_image_repeat() -> None:
    ops = expand_agent_tools(
        [
            {"tool": "select", "id": "title"},
            {"tool": "select"},
            {
                "tool": "edit_node",
                "action": "update",
                "id": "title",
                "parentId": "root",
                "index": 0,
                "box": {"x": 4, "y": 8},
                "layout": {"enabled": False},
                "image": {"imageSrc": "https://example.com/a.png", "objectFit": "contain"},
                "repeat": {"over": "items", "as": "row"},
            },
            {
                "tool": "edit_node",
                "action": "update",
                "id": "box_1",
                "box": {"x": 10, "y": 20, "w": 100, "h": 40},
            },
            {
                "tool": "edit_node",
                "action": "update",
                "id": "box_2",
                "box": {"w": 200, "h": 50},
            },
            {"tool": "edit_node", "action": "remove", "id": "old"},
            {"tool": "edit_node", "action": "add", "kind": "nope"},
            {
                "tool": "edit_variable",
                "action": "update",
                "id": "var_1",
                "label": "Renamed",
            },
            {"tool": "edit_variable", "action": "remove", "id": "var_1"},
            {"tool": "edit_variable", "action": "add", "name": "  "},
            {"tool": "add_two_col", "parentId": "root", "width": 700, "gap": 16},
        ]
    )
    names = [op["op"] for op in ops]
    assert "select" in names
    assert "move_in_tree" in names
    assert "toggle_auto_layout" in names
    assert "update_image" in names
    assert "update_node" in names
    assert "update_box" in names
    assert "resize_node" in names
    assert "remove_element" in names
    assert "update_variable" in names
    assert "remove_variable" in names
    assert names.count("add_element") >= 3  # two-col row + left + right
