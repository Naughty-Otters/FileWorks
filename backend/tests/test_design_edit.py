from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
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
from app.db.models import Base
from app.db.session import get_db
from app.processing.template.design_edit import build_design_edit_prompt, run_design_edit
from app.processing.template.ops_schema import design_edit_schema
from app.processing.template.schema import DesignDocument


def _document() -> DesignDocument:
    return DesignDocument.model_validate(
        {
            "version": 2,
            "pageSize": {"w": 850, "h": 1100},
            "root": {
                "id": "root",
                "kind": "box",
                "label": "Document",
                "children": [
                    {"id": "title", "kind": "heading", "label": "Invoice", "level": 1},
                ],
            },
            "variables": [],
        }
    )


def test_design_edit_schema_requires_reasoning() -> None:
    schema = design_edit_schema()
    step_props = schema["properties"]["steps"]["items"]["properties"]
    assert step_props["reasoning"]["minLength"] == 1
    assert "reasoning" in schema["properties"]["steps"]["items"]["required"]


def test_design_edit_prompt_is_embedded_python_module() -> None:
    """Prompts must not be loose .md files — Docker **/*.md excludes crash Lambda boot."""
    from app.processing.template.design_edit import _system_prompt
    from app.processing.template.prompts.design_edit_prompt import SYSTEM_PROMPT

    prompt = _system_prompt()
    assert prompt == SYSTEM_PROMPT.strip()
    assert "ops" in prompt.lower()
    prompts_dir = Path(__file__).resolve().parents[1] / "app" / "processing" / "template" / "prompts"
    assert list(prompts_dir.glob("*.md")) == []
    assert (prompts_dir / "design_edit_prompt.py").is_file()


def test_build_design_edit_prompt_includes_document_and_message() -> None:
    document = _document()
    prompt = build_design_edit_prompt(
        document,
        "Center the title",
        selection_id="title",
        conversation=[{"role": "user", "content": "Hi"}],
    )
    assert "Center the title" in prompt
    assert "title" in prompt
    assert "Current document:" in prompt
    assert "User request:" in prompt


def test_run_design_edit_normalizes_steps() -> None:
    document = _document()

    class Engine:
        def configured(self) -> bool:
            return True

        def complete_structured(self, prompt: str, schema: dict, *, purpose: str) -> dict:
            assert purpose == "design-edit"
            assert "Center the title" in prompt
            return {
                "reply": "Centered the title.",
                "steps": [
                    {
                        "reasoning": "Title was left-aligned; center improves balance.",
                        "summary": "Center title",
                        "ops": [
                            {
                                "op": "update_style",
                                "id": "title",
                                "patch": {"align": "center"},
                            }
                        ],
                    }
                ],
            }

    result = run_design_edit(document, "Center the title", engine=Engine())
    assert result["reply"] == "Centered the title."
    assert len(result["steps"]) == 1
    assert "left-aligned" in result["steps"][0]["reasoning"]


def test_run_design_edit_rejects_empty_reasoning() -> None:
    document = _document()

    class Engine:
        def configured(self) -> bool:
            return True

        def complete_structured(self, prompt: str, schema: dict, *, purpose: str) -> dict:
            return {
                "reply": "Done.",
                "steps": [{"reasoning": "", "summary": "x", "ops": []}],
            }

    with pytest.raises(RuntimeError, match="reasoning"):
        run_design_edit(document, "test", engine=Engine())


def test_run_design_edit_rejects_empty_reply() -> None:
    document = _document()

    class Engine:
        def configured(self) -> bool:
            return True

        def complete_structured(self, prompt: str, schema: dict, *, purpose: str) -> dict:
            return {"reply": "  ", "steps": []}

    with pytest.raises(RuntimeError, match="empty reply"):
        run_design_edit(document, "test", engine=Engine())


def test_run_design_edit_defaults_missing_summary() -> None:
    document = _document()

    class Engine:
        def configured(self) -> bool:
            return True

        def complete_structured(self, prompt: str, schema: dict, *, purpose: str) -> dict:
            return {
                "reply": "Updated.",
                "steps": [
                    {
                        "reasoning": "Need a clearer label.",
                        "summary": "",
                        "ops": [{"op": "update_label", "id": "title", "label": "Bill"}],
                    }
                ],
            }

    result = run_design_edit(document, "Rename title", engine=Engine())
    assert result["steps"][0]["summary"] == "Edit step"


def test_build_design_edit_prompt_includes_selection_breadcrumb() -> None:
    prompt = build_design_edit_prompt(_document(), "Tweak", selection_id="title")
    assert "selection" in prompt
    assert "heading:title" in prompt or "title" in prompt


def test_edit_endpoint_requires_auth() -> None:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: Principal(
        plan=get_plan("anonymous"), anonymous_id="anon1"
    )
    app.dependency_overrides[get_db] = lambda: None
    client = TestClient(app)
    res = client.post(
        "/api/templates/edit",
        json={"message": "Hi", "document": _document().model_dump(by_alias=True, mode="json")},
    )
    assert res.status_code == 401


def test_edit_endpoint_returns_structured_response(monkeypatch: pytest.MonkeyPatch) -> None:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    session = Session(engine)
    user_id = uuid4()
    user = SimpleNamespace(id=user_id, plan="pro")
    principal = Principal(plan=get_plan("pro"), user=user)  # type: ignore[arg-type]

    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_db] = lambda: session

    def fake_run_design_edit(*_args, **_kwargs):
        return {
            "reply": "Updated heading.",
            "steps": [
                {
                    "reasoning": "Increased size for hierarchy.",
                    "summary": "Enlarge title",
                    "ops": [{"op": "update_style", "id": "title", "patch": {"fontSize": 32}}],
                }
            ],
        }

    monkeypatch.setattr("app.api.template_routes.run_design_edit", fake_run_design_edit)
    monkeypatch.setattr("app.api.template_routes.assert_can_use_ai", lambda *a, **k: None)
    monkeypatch.setattr(
        "app.api.template_routes.LLMEngine",
        lambda *_: type("E", (), {"configured": lambda self: True})(),
    )

    client = TestClient(app)
    res = client.post(
        "/api/templates/edit",
        json={
            "message": "Make title bigger",
            "document": _document().model_dump(by_alias=True, mode="json"),
        },
    )
    assert res.status_code == 200
    payload = res.json()
    assert payload["reply"] == "Updated heading."
    assert payload["steps"][0]["reasoning"] == "Increased size for hierarchy."
    session.close()
