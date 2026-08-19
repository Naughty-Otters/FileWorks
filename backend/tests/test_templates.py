from __future__ import annotations

from io import BytesIO
from types import SimpleNamespace
from typing import ClassVar
from uuid import uuid4

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
from app.processing.template.extract import extract_template_context, extraction_schema
from app.processing.template.runtime import (
    auto_layout,
    expand_repeats,
    interpolate,
    template_analysis,
)
from app.processing.template.schema import DesignDocument
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
    assert "account" in extraction_schema(document)["properties"]

    class Engine:
        def complete_text(self, prompt: str, *, purpose: str) -> str:
            assert '"account"' in prompt
            assert purpose == "template-fill"
            return '```json\n{"account": "Acme"}\n```'

    assert extract_template_context(document, "Account: Acme", engine=Engine()) == {
        "account": "Acme"
    }


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
