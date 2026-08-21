from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from typing import ClassVar
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.template_routes import router
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.core.config import get_settings
from app.db.models import Base
from app.db.session import get_db
from app.processing.template.extract import (
    build_extraction_prompt,
    extract_template_context,
    extraction_schema,
)
from app.processing.template.render import render_docx, render_html, render_markdown
from app.processing.template.runtime import (
    auto_layout,
    coalesce_context,
    default_context,
    expand_repeats,
    interpolate,
    resolve_path,
    template_analysis,
)
from app.processing.template.schema import DesignDocument, VariableSchema
from app.storage import get_document_store
from app.storage.s3 import S3DocumentStore
from app.storage.templates import (
    LocalTemplateBlobStore,
    S3TemplateBlobStore,
    get_template_store,
)


def _document() -> DesignDocument:
    return DesignDocument.model_validate(
        {
            "version": 2,
            "variables": {
                "customer": {"type": "object"},
                "lines": {
                    "type": "list",
                    "items": {"type": "object"},
                },
            },
            "nodes": [
                {"id": "title", "type": "heading", "label": "Invoice for {{ customer.name }}"},
                {
                    "id": "rows",
                    "type": "box",
                    "repeat": {"over": "lines", "as": "line"},
                    "children": [
                        {"id": "row", "type": "paragraph", "label": "{{line.description}}"}
                    ],
                },
            ],
        }
    )


def test_v1_normalizes_and_static_detection_checks_tokens() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 1,
            "pageWidth": 500,
            "elements": [{"id": "a", "type": "image", "imageSrc": "{{ logo.url }}"}],
        }
    )
    assert document.version == 2
    assert document.page.w == 500
    is_static, warnings = template_analysis(document)
    assert not is_static
    assert warnings == ["Undeclared variables used: logo"]


def test_interpolation_repeat_and_layout() -> None:
    document = _document()
    context = {
        "customer": {"name": "Ada"},
        "lines": [{"description": "One"}, {"description": "Two"}],
    }
    assert interpolate("Hi {{customer.name}} {{customer.missing}}", context) == "Hi Ada "
    expanded = expand_repeats(document, context)
    assert expanded.root.children[0].label == "Invoice for Ada"
    assert [node.children[0].label for node in expanded.root.children[1:]] == ["One", "Two"]
    laid_out, warnings = auto_layout(expanded)
    assert not warnings
    assert all(node.w > 0 for node in laid_out.iter_nodes())
    assert all(node.x >= 0 for node in laid_out.iter_nodes())


def test_llm_extraction_includes_undeclared_used_variables() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "nodes": [{"id": "p", "type": "paragraph", "label": "{{account.name}}"}],
        }
    )
    schema = extraction_schema(document, document_name="Account summary")
    assert schema["title"] == "AccountSummaryContext"
    assert "account" in schema["properties"]
    assert "item" not in schema["properties"]

    class Engine:
        def complete_structured(self, prompt: str, schema: dict, *, purpose: str) -> dict:
            assert purpose == "template-fill"
            assert "account" in schema["properties"]
            assert "Target document:" in prompt
            assert "Name: Account summary" in prompt
            assert "Variable context:" in prompt
            assert "`account`" in prompt
            assert "JSON schema:" in prompt
            assert "Source markdown:" in prompt
            assert "Account: Acme" in prompt
            return {"account": "Acme"}

    assert extract_template_context(
        document,
        "Account: Acme",
        engine=Engine(),
        document_name="Account summary",
        document_description="Summarize the billed account",
    ) == {"account": "Acme"}


def test_extraction_prompt_includes_template_and_variable_context() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": [
                {
                    "name": "invoice_spending_items",
                    "label": "Invoice spending items: each billed line from the source",
                    "type": "list",
                    "itemSchema": [
                        {"name": "description", "label": "What this invoice line billed", "type": "text"},
                        {"name": "amount", "label": "Amount charged on this invoice line", "type": "currency"},
                    ],
                }
            ],
            "nodes": [
                {
                    "id": "rows",
                    "type": "box",
                    "repeat": {"over": "invoice_spending_items", "as": "item"},
                    "children": [
                        {"id": "p", "type": "paragraph", "label": "{{ item.description }} {{ item.amount }}"}
                    ],
                }
            ],
        }
    )
    schema = extraction_schema(
        document,
        document_name="Client invoice",
        document_description="Bill-to, spending items, and total",
    )
    assert "item" not in schema["properties"]
    items = schema["properties"]["invoice_spending_items"]
    assert "spending items" in items["description"].lower()
    assert items["items"]["properties"]["description"]["description"] == "What this invoice line billed"

    prompt = build_extraction_prompt(
        document,
        "Widget $12",
        document_name="Client invoice",
        document_description="Bill-to, spending items, and total",
        schema=schema,
    )
    assert "Name: Client invoice" in prompt
    assert "Purpose: Bill-to, spending items, and total" in prompt
    assert "iterates `invoice_spending_items` as `item`" in prompt
    assert "`invoice_spending_items` (list)" in prompt
    assert "What this invoice line billed" in prompt
    assert '"invoice_spending_items"' in prompt
    assert "Source markdown:\nWidget $12" in prompt


def test_llm_extraction_validates_structured_types() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "variables": {"count": {"type": "number", "required": True}},
            "nodes": [{"id": "p", "type": "paragraph", "label": "{{count}}"}],
        }
    )

    class Engine:
        def complete_structured(self, prompt: str, schema: dict, *, purpose: str) -> dict:
            assert "count" in schema["required"]
            return {"count": "nope"}

    with pytest.raises(ValueError, match="must be number"):
        extract_template_context(document, "Count: 1", engine=Engine())


def test_local_template_blob_store_is_separate(tmp_path) -> None:
    store = LocalTemplateBlobStore(tmp_path)
    store.save("user_12345", "template_1", {"version": 2})
    assert store.get("user_12345", "template_1") == {"version": 2}
    assert (tmp_path / "templates" / "user_12345" / "template_1.json").exists()
    assert store.delete("user_12345", "template_1")
    assert store.get("user_12345", "template_1") is None


def test_s3_template_blob_store_uses_separate_prefix() -> None:
    objects: dict[str, bytes] = {}

    class Missing(Exception):
        response: ClassVar = {"Error": {"Code": "NoSuchKey"}}

    class Client:
        def put_object(self, *, Key: str, Body: bytes, **_kwargs) -> None:
            objects[Key] = Body

        def get_object(self, *, Key: str, **_kwargs):
            if Key not in objects:
                raise Missing
            return {"Body": BytesIO(objects[Key])}

        def delete_object(self, *, Key: str, **_kwargs) -> None:
            objects.pop(Key, None)

    document_store = S3DocumentStore(bucket="bucket", prefix="fileworks")
    document_store._client = Client()
    store = S3TemplateBlobStore(document_store)
    store.save("user_12345", "template_1", {"version": 2})
    assert "fileworks/templates/user_12345/template_1/design.json" in objects
    assert store.get("user_12345", "template_1") == {"version": 2}
    assert store.delete("user_12345", "template_1")


def test_static_template_crud_and_render_skips_llm() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = Session(engine)
    user_id = uuid4()
    user = SimpleNamespace(id=user_id, plan="basic")
    principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_db] = lambda: session
    get_document_store.cache_clear()
    get_template_store.cache_clear()
    settings = get_settings()
    settings.storage_backend = "local"
    client = TestClient(app)
    created = client.post(
        "/api/templates",
        json={
            "name": "Letter",
            "document": {
                "version": 2,
                "pageSize": {"w": 850, "h": 1100},
                "root": {
                    "id": "root",
                    "kind": "box",
                    "label": "Document",
                    "x": 0,
                    "y": 0,
                    "w": 850,
                    "h": 1100,
                    "children": [
                        {
                            "id": "p",
                            "kind": "paragraph",
                            "label": "Always here",
                            "x": 20,
                            "y": 20,
                            "w": 300,
                            "h": 60,
                        }
                    ],
                },
                "variables": [],
            },
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["is_static"] is True
    assert body["document"]["root"]["children"][0]["kind"] == "paragraph"
    assert body["document"]["pageSize"] == {"w": 850.0, "h": 1100.0}
    template_id = body["id"]
    rendered = client.post(f"/api/templates/{template_id}/render", json={"format": "html"})
    assert rendered.status_code == 200
    assert "Always here" in rendered.text
    assert client.get("/api/templates").json()["items"][0]["id"] == template_id
    assert client.delete(f"/api/templates/{template_id}").status_code == 200
    session.close()
    get_template_store.cache_clear()
    get_document_store.cache_clear()


def test_default_context_parses_sample_values() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "pageSize": {"w": 850, "h": 1100},
            "root": {
                "id": "root",
                "kind": "box",
                "label": "Document",
                "x": 0,
                "y": 0,
                "w": 850,
                "h": 1100,
                "children": [],
            },
            "variables": [
                {"id": "1", "name": "items", "label": "Items", "type": "list", "sampleValue": '[{"a":1}]'},
                {"id": "2", "name": "bad_list", "label": "Bad", "type": "list", "sampleValue": "nope"},
                {"id": "3", "name": "empty_list", "label": "Empty", "type": "list", "sampleValue": ""},
                {"id": "4", "name": "customer", "label": "Customer", "type": "object", "sampleValue": '{"name":"Ada"}'},
                {"id": "5", "name": "bad_obj", "label": "BadObj", "type": "object", "sampleValue": "["},
                {"id": "6", "name": "empty_obj", "label": "EmptyObj", "type": "object", "sampleValue": ""},
                {"id": "7", "name": "qty", "label": "Qty", "type": "number", "sampleValue": ""},
                {"id": "8", "name": "price", "label": "Price", "type": "currency", "sampleValue": ""},
                {"id": "9", "name": "co", "label": "Acme", "type": "text", "sampleValue": ""},
                {"id": "10", "name": "logo", "label": "Logo", "type": "image", "sampleValue": ""},
                {"id": "11", "name": "note", "label": "Note", "type": "text", "sampleValue": " hello "},
                {"id": "12", "name": "not_list", "label": "NL", "type": "list", "sampleValue": '{"x":1}'},
                {"id": "13", "name": "not_obj", "label": "NO", "type": "object", "sampleValue": "[1]"},
            ],
        }
    )
    ctx = default_context(document)
    assert ctx["items"] == [{"a": 1}]
    assert ctx["bad_list"] == []
    assert ctx["empty_list"] == []
    assert ctx["customer"] == {"name": "Ada"}
    assert ctx["bad_obj"] == {}
    assert ctx["empty_obj"] == {}
    assert ctx["qty"] == "0"
    assert ctx["price"] == "$0.00"
    assert ctx["co"] == "Acme"
    assert ctx["logo"] == ""
    assert ctx["note"] == "hello"
    assert ctx["not_list"] == []
    assert ctx["not_obj"] == {}


def test_resolve_path_and_interpolate_collections() -> None:
    context = {"rows": [{"name": "A"}, {"name": "B"}], "meta": {"n": 1}}
    assert resolve_path(context, "rows.0.name") == "A"
    assert resolve_path(context, "rows.9.name") is None
    assert resolve_path(context, "rows.x") is None
    assert resolve_path(context, "bad path!") is None
    assert interpolate(None, context) == ""
    assert interpolate("{{ rows }} / {{ meta }}", context) == str(context["rows"]) + " / " + str(context["meta"])


def test_expand_skips_non_list_repeats_and_clamps_layout() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "pageSize": {"w": 100, "h": 80},
            "root": {
                "id": "root",
                "kind": "box",
                "label": "Document",
                "x": 0,
                "y": 0,
                "w": 100,
                "h": 80,
                "children": [
                    {
                        "id": "row",
                        "kind": "box",
                        "label": "Row",
                        "x": 0,
                        "y": 0,
                        "w": 40,
                        "h": 20,
                        "repeat": {"over": "missing", "as": "item"},
                        "children": [],
                    },
                    {
                        "id": "tall",
                        "kind": "paragraph",
                        "label": "Hi",
                        "x": -10,
                        "y": 90,
                        "w": 200,
                        "h": 50,
                    },
                ],
            },
            "variables": [],
        }
    )
    expanded = expand_repeats(document, {})
    assert len(expanded.root.children) == 1
    laid_out, warnings = auto_layout(expanded)
    assert warnings
    tall = next(node for node in laid_out.iter_nodes() if node.id == "tall")
    assert tall.x == 0
    assert tall.w <= 100
    assert tall.y + tall.h <= 80


def test_render_html_and_docx_cover_node_kinds() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "pageSize": {"w": 400, "h": 500},
            "root": {
                "id": "root",
                "kind": "box",
                "label": "Document",
                "x": 0,
                "y": 0,
                "w": 400,
                "h": 500,
                "style": {"bold": True, "italic": True, "underline": True, "fontSize": 14},
                "children": [
                    {
                        "id": "h",
                        "kind": "heading",
                        "label": "Title",
                        "level": 2,
                        "x": 10,
                        "y": 10,
                        "w": 200,
                        "h": 40,
                    },
                    {
                        "id": "p",
                        "kind": "paragraph",
                        "label": "Line\nTwo",
                        "x": 10,
                        "y": 60,
                        "w": 200,
                        "h": 40,
                    },
                    {
                        "id": "img",
                        "kind": "image",
                        "label": "Logo",
                        "imageSrc": "https://example.com/a.png",
                        "objectFit": "contain",
                        "x": 10,
                        "y": 120,
                        "w": 80,
                        "h": 80,
                    },
                    {
                        "id": "bad",
                        "kind": "image",
                        "label": "Bad",
                        "imageSrc": "javascript:alert(1)",
                        "x": 10,
                        "y": 220,
                        "w": 80,
                        "h": 80,
                    },
                    {
                        "id": "empty",
                        "kind": "image",
                        "label": "Empty",
                        "imageSrc": "",
                        "x": 10,
                        "y": 320,
                        "w": 80,
                        "h": 80,
                    },
                ],
            },
            "variables": [],
        }
    )
    html = render_html(document, title="Demo")
    assert "Title" in html
    assert "Line<br>Two" in html
    assert "https://example.com/a.png" in html
    assert "javascript:alert" not in html
    docx = render_docx(document, title="Demo")
    assert docx[:2] == b"PK"


def test_render_uses_variable_defaults_without_request_context() -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = Session(engine)
    user_id = uuid4()
    user = SimpleNamespace(id=user_id, plan="basic")
    principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_db] = lambda: session
    get_document_store.cache_clear()
    get_template_store.cache_clear()
    settings = get_settings()
    settings.storage_backend = "local"
    client = TestClient(app)
    created = client.post(
        "/api/templates",
        json={
            "name": "Paystub",
            "document": {
                "version": 2,
                "pageSize": {"w": 850, "h": 1100},
                "root": {
                    "id": "root",
                    "kind": "box",
                    "label": "Document",
                    "x": 0,
                    "y": 0,
                    "w": 850,
                    "h": 1100,
                    "children": [
                        {
                            "id": "p",
                            "kind": "paragraph",
                            "label": "Hello {{ employee_name }}",
                            "x": 20,
                            "y": 20,
                            "w": 300,
                            "h": 60,
                        }
                    ],
                },
                "variables": [
                    {
                        "id": "v1",
                        "name": "employee_name",
                        "label": "Employee",
                        "type": "text",
                        "sampleValue": "Jane Doe",
                    }
                ],
            },
        },
    )
    assert created.status_code == 201, created.text
    template_id = created.json()["id"]
    rendered = client.post(f"/api/templates/{template_id}/render", json={"format": "html"})
    assert rendered.status_code == 200, rendered.text
    assert "Jane Doe" in rendered.text
    assert client.delete(f"/api/templates/{template_id}").status_code == 200
    session.close()
    get_template_store.cache_clear()
    get_document_store.cache_clear()


def test_variable_schema_label_fallback() -> None:
    variable = VariableSchema(name="x", label="", type="date", sampleValue="")
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "pageSize": {"w": 100, "h": 100},
            "root": {
                "id": "root",
                "kind": "box",
                "label": "Document",
                "x": 0,
                "y": 0,
                "w": 100,
                "h": 100,
                "children": [],
            },
            "variables": [variable.model_dump(by_alias=True)],
        }
    )
    assert default_context(document)["x"] == "x"


def test_coalesce_context_prefers_nonempty_layers() -> None:
    defaults = {"name": "Jane Doe", "total": "$10.00", "items": [{"a": 1}], "note": "sample"}
    extracted = {"name": "Ada Lovelace", "total": "", "items": [], "note": "  "}
    overrides = {"note": "explicit"}
    merged = coalesce_context(defaults, extracted, overrides)
    assert merged["name"] == "Ada Lovelace"
    assert merged["total"] == "$10.00"
    assert merged["items"] == [{"a": 1}]
    assert merged["note"] == "explicit"


def test_render_markdown_linearizes_tree() -> None:
    document = DesignDocument.model_validate(
        {
            "version": 2,
            "pageSize": {"w": 850, "h": 1100},
            "root": {
                "id": "root",
                "kind": "box",
                "label": "Document",
                "x": 0,
                "y": 0,
                "w": 850,
                "h": 1100,
                "children": [
                    {
                        "id": "h",
                        "kind": "heading",
                        "level": 1,
                        "label": "Title",
                        "x": 0,
                        "y": 0,
                        "w": 200,
                        "h": 40,
                    },
                    {
                        "id": "p",
                        "kind": "paragraph",
                        "label": "Body copy",
                        "x": 0,
                        "y": 50,
                        "w": 200,
                        "h": 40,
                    },
                ],
            },
            "variables": [],
        }
    )
    md = render_markdown(document)
    assert "# Title" in md
    assert "Body copy" in md


def test_render_ai_fill_uses_document_values_not_only_defaults(monkeypatch) -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = Session(engine)
    user_id = uuid4()
    user = SimpleNamespace(id=user_id, plan="basic")
    principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_db] = lambda: session
    get_document_store.cache_clear()
    get_template_store.cache_clear()
    settings = get_settings()
    settings.storage_backend = "local"
    client = TestClient(app)
    created = client.post(
        "/api/templates",
        json={
            "name": "Invoice",
            "document": {
                "version": 2,
                "pageSize": {"w": 850, "h": 1100},
                "root": {
                    "id": "root",
                    "kind": "box",
                    "label": "Document",
                    "x": 0,
                    "y": 0,
                    "w": 850,
                    "h": 1100,
                    "children": [
                        {
                            "id": "p",
                            "kind": "paragraph",
                            "label": "Bill {{ client_name }} total {{ total }}",
                            "x": 20,
                            "y": 20,
                            "w": 400,
                            "h": 60,
                        }
                    ],
                },
                "variables": [
                    {
                        "id": "v1",
                        "name": "client_name",
                        "label": "Client",
                        "type": "text",
                        "sampleValue": "Sample Client",
                    },
                    {
                        "id": "v2",
                        "name": "total",
                        "label": "Total",
                        "type": "currency",
                        "sampleValue": "$0.00",
                    },
                ],
            },
        },
    )
    assert created.status_code == 201, created.text
    template_id = created.json()["id"]

    def fake_extract(document, markdown, engine=None, **_kwargs):
        assert "Northwind" in markdown
        return {"client_name": "Northwind Trading", "total": "$2,750.00"}

    monkeypatch.setattr(
        "app.api.template_routes.extract_template_context",
        fake_extract,
    )
    rendered = client.post(
        f"/api/templates/{template_id}/render",
        json={
            "format": "html",
            "fill": "auto",
            "markdown": "Invoice for Northwind Trading totaling $2,750.00",
        },
    )
    assert rendered.status_code == 200, rendered.text
    assert rendered.headers.get("X-Template-Fill") == "ai"
    assert "Northwind Trading" in rendered.text
    assert "$2,750.00" in rendered.text
    assert "Sample Client" not in rendered.text

    defaults_only = client.post(
        f"/api/templates/{template_id}/render",
        json={"format": "html", "fill": "defaults"},
    )
    assert defaults_only.status_code == 200
    assert defaults_only.headers.get("X-Template-Fill") == "defaults"
    assert "Sample Client" in defaults_only.text

    md = client.post(
        f"/api/templates/{template_id}/render",
        json={"format": "markdown", "fill": "defaults"},
    )
    assert md.status_code == 200
    assert "text/markdown" in md.headers.get("content-type", "")
    assert "Sample Client" in md.text

    assert client.delete(f"/api/templates/{template_id}").status_code == 200
    session.close()
    get_template_store.cache_clear()
    get_document_store.cache_clear()


def test_builtin_starters_catalog_and_render_with_variables() -> None:
    from app.processing.template.starters import clear_starter_cache, list_starter_summaries

    clear_starter_cache()
    summaries = list_starter_summaries()
    ids = {item["id"] for item in summaries}
    assert "family_daily" in ids
    assert "family_yearly" in ids
    assert "meeting_agenda" in ids
    assert "task_list" in ids
    assert "timesheet" in ids

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = Session(engine)
    user_id = uuid4()
    user = SimpleNamespace(id=user_id, plan="basic")
    principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_db] = lambda: session
    client = TestClient(app)

    catalog = client.get("/api/templates/starters")
    assert catalog.status_code == 200, catalog.text
    payload = catalog.json()
    assert len(payload["items"]) >= 16
    assert any(cat["id"] == "family" for cat in payload["categories"])
    daily = next(item for item in payload["items"] if item["id"] == "family_daily")
    assert daily["variable_count"] > 0
    assert any(var["name"] == "family_daily_blocks" for var in daily["variables"])

    detail = client.get("/api/templates/starters/family_daily")
    assert detail.status_code == 200, detail.text
    assert detail.json()["document"]["version"] == 2
    assert detail.json()["document"]["variables"]

    rendered = client.post(
        "/api/templates/starters/family_daily/render",
        json={
            "format": "html",
            "fill": "none",
            "variables": {
                "family_name": "The API Family",
                "day_name": "Friday",
                "schedule_date": "March 20, 2026",
                "family_daily_blocks": [
                    {"time": "9:00 AM", "activity": "API smoke test"},
                ],
                "breakfast": "Toast",
                "lunch": "Salad",
                "dinner": "Pasta",
                "daily_reminders": "Ship starters",
                "daily_notes": "Rendered via starter params",
            },
        },
    )
    assert rendered.status_code == 200, rendered.text
    assert rendered.headers.get("X-Template-Fill") == "none"
    assert "The API Family" in rendered.text
    assert "API smoke test" in rendered.text
    assert "9:00 AM" in rendered.text

    defaults = client.post(
        "/api/templates/starters/meeting_agenda/render",
        json={"format": "html", "fill": "defaults"},
    )
    assert defaults.status_code == 200, defaults.text
    assert "Weekly product sync" in defaults.text

    missing = client.get("/api/templates/starters/not_a_real_starter")
    assert missing.status_code == 404

    session.close()
