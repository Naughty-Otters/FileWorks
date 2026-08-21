from __future__ import annotations

from typing import Any

import pytest

from app.engines.llm.providers.base import LLMClientError, parse_json_object
from app.processing.template.extract import (
    EXTRACT_PROMPT,
    build_extraction_prompt,
    extract_template_context,
    extraction_schema,
)
from app.processing.template.runtime import coalesce_context, default_context, expand_repeats
from app.processing.template.schema import DesignDocument

INVOICE_MARKDOWN = """\
# Acme Studio
123 Market St, City, ST 00000
billing@acme.example

INVOICE INV-1042
Date: March 1, 2026

Bill To
Northwind Trading
500 Harbor Ave, City, ST 00000
ap@northwind.example

| Description | Amount |
| --- | --- |
| Design retainer — March | $2,400.00 |
| Print production | $350.00 |

Total due: $2,750.00
Payment due within 30 days.
"""

INVOICE_EXTRACTED = {
    "company_name": "Acme Studio",
    "company_address": "123 Market St, City, ST 00000",
    "company_email": "billing@acme.example",
    "invoice_number": "INV-1042",
    "invoice_date": "March 1, 2026",
    "client_name": "Northwind Trading",
    "client_address": "500 Harbor Ave, City, ST 00000",
    "client_email": "ap@northwind.example",
    "invoice_spending_items": [
        {"description": "Design retainer — March", "amount": "$2,400.00"},
        {"description": "Print production", "amount": "$350.00"},
    ],
    "invoice_total": "$2,750.00",
    "invoice_notes": "Payment due within 30 days.",
}


def _invoice_document() -> DesignDocument:
    return DesignDocument.model_validate(
        {
            "version": 2,
            "variables": [
                {"name": "company_name", "label": "Issuing company name on the invoice", "type": "text"},
                {"name": "company_address", "label": "Issuing company mailing address", "type": "text"},
                {"name": "company_email", "label": "Issuing company billing email", "type": "text"},
                {"name": "invoice_number", "label": "Invoice number or identifier", "type": "text"},
                {"name": "invoice_date", "label": "Invoice issue date", "type": "date"},
                {"name": "client_name", "label": "Bill-to client or customer name", "type": "text"},
                {"name": "client_address", "label": "Bill-to client address", "type": "text"},
                {"name": "client_email", "label": "Bill-to client email", "type": "text"},
                {
                    "name": "invoice_spending_items",
                    "label": "Invoice spending items: each billed line from the source (description and amount)",
                    "type": "list",
                    "itemSchema": [
                        {"name": "description", "label": "What this invoice line billed", "type": "text"},
                        {"name": "amount", "label": "Amount charged on this invoice line", "type": "currency"},
                    ],
                },
                {"name": "invoice_total", "label": "Invoice grand total due", "type": "currency"},
                {"name": "invoice_notes", "label": "Invoice notes, payment terms, or footer remarks", "type": "text"},
            ],
            "nodes": [
                {"id": "h", "kind": "heading", "label": "{{ company_name }}"},
                {
                    "id": "addr",
                    "kind": "paragraph",
                    "label": "{{ company_address }}\n{{ company_email }}",
                },
                {
                    "id": "meta",
                    "kind": "paragraph",
                    "label": "Invoice #: {{ invoice_number }}\nDate: {{ invoice_date }}",
                },
                {
                    "id": "bill",
                    "kind": "paragraph",
                    "label": "{{ client_name }}\n{{ client_address }}\n{{ client_email }}",
                },
                {
                    "id": "row",
                    "kind": "box",
                    "label": "Line item",
                    "repeat": {"over": "invoice_spending_items", "as": "item"},
                    "children": [
                        {"id": "desc", "kind": "paragraph", "label": "{{ item.description }}"},
                        {"id": "amt", "kind": "paragraph", "label": "{{ item.amount }}"},
                    ],
                },
                {"id": "total", "kind": "heading", "label": "{{ invoice_total }}"},
                {"id": "notes", "kind": "paragraph", "label": "{{ invoice_notes }}"},
            ],
        }
    )


class RecordingEngine:
    def __init__(self, result: dict[str, Any] | Any) -> None:
        self.result = result
        self.prompt = ""
        self.schema: dict[str, Any] = {}
        self.purpose = ""

    def complete_structured(self, prompt: str, schema: dict[str, Any], *, purpose: str) -> dict[str, Any]:
        self.prompt = prompt
        self.schema = schema
        self.purpose = purpose
        if callable(self.result):
            return self.result(prompt, schema)
        return self.result


class FencedEngine:
    def __init__(self, raw: str) -> None:
        self.raw = raw

    def complete_structured(self, prompt: str, schema: dict[str, Any], *, purpose: str) -> dict[str, Any]:
        del prompt, schema, purpose
        return parse_json_object(self.raw)


def test_invoice_extracts_spending_items_and_parties() -> None:
    document = _invoice_document()
    engine = RecordingEngine(INVOICE_EXTRACTED)
    value = extract_template_context(
        document,
        INVOICE_MARKDOWN,
        engine=engine,
        document_name="Client invoice",
        document_description="Design the invoice customers receive — bill-to, line items, and total",
    )
    assert value == INVOICE_EXTRACTED
    assert engine.purpose == "template-fill"
    assert engine.prompt.startswith(EXTRACT_PROMPT)
    assert "Name: Client invoice" in engine.prompt
    assert "Purpose: Design the invoice customers receive" in engine.prompt
    assert "Layout placeholders:" in engine.prompt
    assert "iterates `invoice_spending_items` as `item`" in engine.prompt
    assert "`invoice_spending_items` (list):" in engine.prompt
    assert "What this invoice line billed" in engine.prompt
    assert "JSON schema:" in engine.prompt
    assert '"title": "ClientInvoiceContext"' in engine.prompt
    assert "Source markdown:" in engine.prompt
    assert "INV-1042" in engine.prompt
    assert "item" not in engine.schema["properties"]
    items = engine.schema["properties"]["invoice_spending_items"]
    assert items["type"] == "array"
    assert items["items"]["properties"]["amount"]["description"] == "Amount charged on this invoice line"


def test_invoice_expand_repeats_one_row_per_spending_item() -> None:
    document = _invoice_document()
    filled = expand_repeats(document, INVOICE_EXTRACTED)
    rows = [node for node in filled.root.children if node.id.startswith("row-")]
    assert [node.children[0].label for node in rows] == [
        "Design retainer — March",
        "Print production",
    ]
    assert [node.children[1].label for node in rows] == ["$2,400.00", "$350.00"]
    headings = [node.label for node in filled.root.children if node.type == "heading"]
    assert "Acme Studio" in headings
    assert "$2,750.00" in headings


def test_missing_source_facts_keep_empty_strings_and_arrays() -> None:
    document = _invoice_document()
    empty = {
        "company_name": "Acme Studio",
        "company_address": "",
        "company_email": "",
        "invoice_number": "",
        "invoice_date": "",
        "client_name": "",
        "client_address": "",
        "client_email": "",
        "invoice_spending_items": [],
        "invoice_total": "",
        "invoice_notes": "",
    }
    value = extract_template_context(document, "# Acme Studio\n", engine=RecordingEngine(empty))
    assert value["invoice_spending_items"] == []
    assert value["invoice_total"] == ""
    defaults = default_context(document)
    merged = coalesce_context(defaults, value, {})
    assert merged["company_name"] == "Acme Studio"
    assert merged["invoice_spending_items"] == []
    assert merged["invoice_total"] == defaults["invoice_total"]


def test_receipt_purchased_items_from_till_table() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": [
                {"name": "store_name", "label": "Store or merchant name on the receipt", "type": "text"},
                {
                    "name": "receipt_purchased_items",
                    "label": "Receipt purchased items: each sold line from the source",
                    "type": "list",
                    "itemSchema": [
                        {"name": "description", "label": "Purchased item description", "type": "text"},
                        {"name": "amount", "label": "Purchased item amount", "type": "currency"},
                    ],
                },
                {"name": "receipt_total", "label": "Receipt total charged", "type": "currency"},
            ],
            "nodes": [
                {"id": "h", "kind": "heading", "label": "{{ store_name }}"},
                {
                    "id": "row",
                    "kind": "box",
                    "label": "Item",
                    "repeat": {"over": "receipt_purchased_items", "as": "item"},
                    "children": [{"id": "p", "kind": "paragraph", "label": "{{ item.description }}"}],
                },
                {"id": "t", "kind": "paragraph", "label": "{{ receipt_total }}"},
            ],
        }
    )
    extracted = {
        "store_name": "Your Store",
        "receipt_purchased_items": [
            {"description": "Coffee", "amount": "$4.50"},
            {"description": "Pastry", "amount": "$3.25"},
        ],
        "receipt_total": "$18.90",
    }
    engine = RecordingEngine(extracted)
    value = extract_template_context(
        document,
        "Your Store\nCoffee $4.50\nPastry $3.25\nTotal $18.90",
        engine=engine,
        document_name="Store receipt",
    )
    assert value == extracted
    assert engine.schema["title"] == "StoreReceiptContext"
    assert "item" not in engine.schema["properties"]
    assert "`receipt_purchased_items` (list)" in engine.prompt


def test_statement_keeps_signed_transaction_amounts() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": [
                {
                    "name": "statement_transactions",
                    "label": "Account statement transactions for the period",
                    "type": "list",
                    "itemSchema": [
                        {"name": "date", "label": "Transaction date", "type": "date"},
                        {"name": "description", "label": "Transaction description", "type": "text"},
                        {"name": "amount", "label": "Transaction amount (signed)", "type": "currency"},
                    ],
                }
            ],
            "nodes": [
                {
                    "id": "row",
                    "kind": "box",
                    "repeat": {"over": "statement_transactions", "as": "tx"},
                    "children": [{"id": "p", "kind": "paragraph", "label": "{{ tx.amount }}"}],
                }
            ],
        }
    )
    extracted = {
        "statement_transactions": [
            {"date": "01/03", "description": "Grocery Store", "amount": "-$86.20"},
            {"date": "01/07", "description": "Payroll Deposit", "amount": "+$2,400.00"},
        ]
    }
    value = extract_template_context(document, "01/03 Grocery Store -$86.20", engine=RecordingEngine(extracted))
    assert value["statement_transactions"][0]["amount"] == "-$86.20"
    expanded = expand_repeats(document, value)
    rows = [node for node in expanded.root.children if node.id.startswith("row-")]
    assert [node.children[0].label for node in rows] == ["-$86.20", "+$2,400.00"]


def test_letter_body_can_be_a_prose_abstraction() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": [
                {"name": "sender_name", "label": "Letter sender name", "type": "text"},
                {"name": "letter_body", "label": "Letter body paragraphs from the source correspondence", "type": "text"},
            ],
            "nodes": [{"id": "p", "kind": "paragraph", "label": "{{ letter_body }}"}],
        }
    )
    body = (
        "I am writing to follow up on our recent conversation and outline the next steps we discussed."
    )
    value = extract_template_context(
        document,
        f"Alex Rivera\n\nDear Jordan,\n\n{body}\n\nSincerely,\nAlex",
        engine=RecordingEngine({"sender_name": "Alex Rivera", "letter_body": body}),
        document_name="Letterhead letter",
    )
    assert "follow up" in value["letter_body"]
    assert value["sender_name"] == "Alex Rivera"


def test_object_and_image_variables_use_string_fields() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": [
                {
                    "name": "customer",
                    "label": "Customer party on the document",
                    "type": "object",
                    "itemSchema": [
                        {"name": "name", "label": "Customer name", "type": "text"},
                        {"name": "email", "label": "Customer email", "type": "text"},
                    ],
                },
                {"name": "logo", "label": "Company logo URL or data URI", "type": "image"},
            ],
            "nodes": [
                {"id": "p", "kind": "paragraph", "label": "{{ customer.name }}"},
                {"id": "img", "kind": "image", "imageSrc": "{{ logo }}"},
            ],
        }
    )
    schema = extraction_schema(document)
    assert schema["properties"]["customer"]["type"] == "object"
    assert schema["properties"]["customer"]["properties"]["name"]["description"] == "Customer name"
    assert schema["properties"]["logo"]["type"] == "string"
    prompt = build_extraction_prompt(document, "Acme")
    assert "`customer` (object): Customer party on the document Fields:" in prompt
    assert "`logo` (image):" in prompt
    value = extract_template_context(
        document,
        "Acme, billing@acme.example",
        engine=RecordingEngine(
            {"customer": {"name": "Acme", "email": "billing@acme.example"}, "logo": "https://cdn.example/logo.png"}
        ),
    )
    assert value["customer"]["name"] == "Acme"


def test_schema_title_untitled_and_leading_digit() -> None:
    document = DesignDocument.model_validate(
        {"version": 2, "nodes": [{"id": "p", "kind": "paragraph", "label": "static"}]}
    )
    assert extraction_schema(document)["title"] == "TemplateContext"
    assert "Untitled template" in build_extraction_prompt(document, "x")
    assert "Purpose:" not in build_extraction_prompt(document, "x")
    named = extraction_schema(document, document_name="2024 Q1 invoice")
    assert named["title"].startswith("Template")
    assert named["title"].endswith("Context")
    assert "2024" in named["title"]


def test_undeclared_placeholder_is_string_not_repeat_alias() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": [
                {
                    "name": "invoice_spending_items",
                    "type": "list",
                    "itemSchema": [{"name": "description", "type": "text"}],
                }
            ],
            "nodes": [
                {
                    "id": "row",
                    "kind": "box",
                    "repeat": {"over": "invoice_spending_items", "as": "item"},
                    "children": [{"id": "p", "kind": "paragraph", "label": "{{ item.description }} {{ account.ref }}"}],
                }
            ],
        }
    )
    schema = extraction_schema(document)
    assert "item" not in schema["properties"]
    assert schema["properties"]["account"]["type"] == "string"
    prompt = build_extraction_prompt(document, "Ref 9")
    catalog = prompt.split("Variable context:")[1].split("JSON schema:")[0]
    assert "`account` (string): used in the template as {{ account.ref }}" in prompt
    assert "`item`" not in catalog


def test_long_layout_placeholder_is_truncated() -> None:
    token = "{{ " + "a" * 200 + " }}"
    document = DesignDocument.model_validate(
        {"version": 2, "nodes": [{"id": "p", "kind": "paragraph", "label": token}]}
    )
    prompt = build_extraction_prompt(document, "src")
    layout = prompt.split("Layout placeholders:")[1].split("Variable context:")[0]
    assert "..." in layout
    assert len(max(layout.splitlines(), key=len)) <= 180


def test_list_row_must_be_object_and_nested_types_are_checked() -> None:
    document = _invoice_document()

    class AsString:
        def complete_structured(self, prompt: str, schema: dict, *, purpose: str) -> dict:
            return {**INVOICE_EXTRACTED, "invoice_spending_items": "not-a-list"}

    with pytest.raises(ValueError, match="invoice_spending_items must be array"):
        extract_template_context(document, INVOICE_MARKDOWN, engine=AsString())

    class BadRow:
        def complete_structured(self, prompt: str, schema: dict, *, purpose: str) -> dict:
            return {**INVOICE_EXTRACTED, "invoice_spending_items": ["Design retainer"]}

    with pytest.raises(ValueError, match=r"invoice_spending_items\[0\] must be object"):
        extract_template_context(document, INVOICE_MARKDOWN, engine=BadRow())

    class BadAmount:
        def complete_structured(self, prompt: str, schema: dict, *, purpose: str) -> dict:
            return {
                **INVOICE_EXTRACTED,
                "invoice_spending_items": [{"description": "A", "amount": 2400}],
            }

    with pytest.raises(ValueError, match="amount must be string"):
        extract_template_context(document, INVOICE_MARKDOWN, engine=BadAmount())


def test_required_variable_and_boolean_are_not_numbers() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": {
                "count": {"type": "number", "required": True},
                "ok": {"type": "boolean"},
            },
            "nodes": [{"id": "p", "kind": "paragraph", "label": "{{ count }}"}],
        }
    )
    schema = extraction_schema(document)
    assert schema["required"] == ["count"]

    with pytest.raises(ValueError, match="count is required"):
        extract_template_context(document, "n", engine=RecordingEngine({}))
    with pytest.raises(ValueError, match="count must be number"):
        extract_template_context(document, "n", engine=RecordingEngine({"count": True}))
    assert extract_template_context(document, "n", engine=RecordingEngine({"count": 3, "ok": False})) == {
        "count": 3,
        "ok": False,
    }


def test_required_list_item_field() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": [
                {
                    "name": "rows",
                    "type": "list",
                    "itemSchema": [{"name": "description", "type": "text", "required": True}],
                }
            ],
            "nodes": [{"id": "p", "kind": "paragraph", "label": "{{ rows }}"}],
        }
    )
    with pytest.raises(ValueError, match="description is required"):
        extract_template_context(document, "x", engine=RecordingEngine({"rows": [{}]}))


def test_fenced_json_corner_cases_feed_extract() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": [{"name": "client_name", "label": "Bill-to client", "type": "text"}],
            "nodes": [{"id": "p", "kind": "paragraph", "label": "{{ client_name }}"}],
        }
    )
    payload = {"client_name": "Northwind Trading"}
    cases = [
        '```json\n{"client_name": "Northwind Trading"}\n```',
        '```JSON {"client_name": "Northwind Trading"} ```',
        'Sure:\n```json\n{"client_name": "Northwind Trading"}\n```\nDone.',
        '```json\n{"client_name": "Northwind Trading"}',
        'Here: {"client_name": "Northwind Trading"} thanks',
        '\ufeff{"client_name": "Northwind Trading"}',
        '```javascript\n{"client_name": "Northwind Trading"}\n```',
        '```\nnot json\n```\n```json\n{"client_name": "Northwind Trading"}\n```',
    ]
    for raw in cases:
        assert extract_template_context(document, "Northwind", engine=FencedEngine(raw)) == payload


def test_parse_json_object_rejects_non_objects_and_garbage() -> None:
    with pytest.raises(LLMClientError):
        parse_json_object("nope")
    with pytest.raises(LLMClientError):
        parse_json_object("[1, 2]")
    with pytest.raises(LLMClientError):
        parse_json_object("")
    with pytest.raises(LLMClientError):
        parse_json_object("```json\n[1]\n```")
    nested = parse_json_object('Intro {"outer": {"inner": "Ada"}} outro')
    assert nested == {"outer": {"inner": "Ada"}}
    with_braces = parse_json_object('{"note": "use {curly} braces"}')
    assert with_braces["note"] == "use {curly} braces"


def test_extra_model_keys_are_kept_and_unknown_types_skip_strict_check() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": [{"name": "client_name", "type": "text"}],
            "nodes": [{"id": "p", "kind": "paragraph", "label": "{{ client_name }}"}],
        }
    )
    value = extract_template_context(
        document,
        "Ada",
        engine=RecordingEngine({"client_name": "Ada", "unexpected": 1}),
    )
    assert value["client_name"] == "Ada"
    assert value["unexpected"] == 1


def test_no_declared_variables_still_builds_catalog_from_placeholders() -> None:
    document = DesignDocument.model_validate(
        {"version": 2, "nodes": [{"id": "p", "kind": "paragraph", "label": "{{ account.name }}"}]}
    )
    prompt = build_extraction_prompt(document, "Account: Acme", document_name="Account summary")
    assert "- (none declared" not in prompt
    assert "`account` (string): used in the template as {{ account.name }}" in prompt
    assert extract_template_context(
        document, "Account: Acme", engine=RecordingEngine({"account": "Acme"})
    ) == {"account": "Acme"}
