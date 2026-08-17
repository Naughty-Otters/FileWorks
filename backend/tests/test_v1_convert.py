from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import router as v1_router
from app.auth.api_plans import get_api_plan
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.db.session import get_db


def _app(principal: Principal) -> FastAPI:
    app = FastAPI()
    app.include_router(v1_router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_db] = lambda: None
    return app


def _api_principal(*, workspace: str = "basic", api: str = "api_free") -> Principal:
    user = SimpleNamespace(id=uuid4(), email="b@x.co", plan=workspace, api_plan=api)
    return Principal(
        plan=get_plan(workspace),
        user=user,  # type: ignore[arg-type]
        api_plan=get_api_plan(api),
        via_api_key=True,
    )


class V1ConvertTests(unittest.TestCase):
    def test_catalog_lists_ui_options_without_auth(self) -> None:
        principal = Principal(plan=get_plan("anonymous"), anonymous_id="anon")
        client = TestClient(_app(principal))
        res = client.get("/api/v1/convert")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn(".pdf", body["input_extensions"])
        self.assertIn(".txt", body["input_extensions"])
        target_ids = [item["id"] for item in body["targets"]]
        self.assertEqual(target_ids, ["markdown", "txt", "html", "json", "docx", "pdf"])
        pdf = next(item for item in body["targets"] if item["id"] == "pdf")
        self.assertFalse(pdf["available"])
        self.assertTrue(next(item for item in body["targets"] if item["id"] == "docx")["available"])
        option_names = [item["name"] for item in body["options"]]
        self.assertIn("use_ai", option_names)
        self.assertIn("prefer_structure", option_names)
        self.assertIn("target_lang", option_names)
        self.assertIn("use_table_recognition", option_names)
        self.assertIn("credits", body)
        self.assertEqual(body["credits"]["standard_per_page"], 1)
        self.assertEqual(body["credits"]["ai_per_page"], 3)

    def test_guest_cannot_convert(self) -> None:
        principal = Principal(plan=get_plan("anonymous"), anonymous_id="anon")
        client = TestClient(_app(principal))
        res = client.post(
            "/api/v1/convert",
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()["detail"]["code"], "api_key_required")

    def test_workspace_jwt_cannot_convert(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic", api_plan="api_free")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        res = client.post(
            "/api/v1/convert",
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()["detail"]["code"], "api_key_required")

    def test_rejects_s3_key_only_request(self) -> None:
        principal = _api_principal()
        client = TestClient(_app(principal))
        res = client.post("/api/v1/convert", data={"s3_key": "uploads/foo.pdf"})
        self.assertEqual(res.status_code, 422)

    def test_rejects_unknown_target_with_available_list(self) -> None:
        principal = _api_principal()
        client = TestClient(_app(principal))
        res = client.post(
            "/api/v1/convert",
            data={"target": "xlsx"},
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
        self.assertEqual(res.status_code, 400)
        detail = res.json()["detail"]
        self.assertEqual(detail["code"], "unsupported_target")
        self.assertIn("markdown", detail["available"])
        self.assertNotIn("pdf", detail["available"])

    def test_rejects_pdf_target(self) -> None:
        principal = _api_principal()
        client = TestClient(_app(principal))
        res = client.post(
            "/api/v1/convert",
            data={"target": "pdf"},
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["detail"]["code"], "unsupported_target")

    def test_rejects_use_ai_when_unavailable(self) -> None:
        principal = _api_principal()
        client = TestClient(_app(principal))
        with patch("app.api.v1.catalog._ai_ready", return_value=(False, "AI reading is not configured")):
            res = client.post(
                "/api/v1/convert",
                data={"use_ai": "true"},
                files={"file": ("note.txt", b"hello", "text/plain")},
            )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["detail"]["code"], "option_unavailable")
        self.assertEqual(res.json()["detail"]["field"], "use_ai")

    def test_one_shot_returns_html(self) -> None:
        principal = _api_principal()
        client = TestClient(_app(principal))
        with patch(
            "app.api.v1.convert.run_conversion",
            new=AsyncMock(return_value={"markdown": "# Hello", "engine": "text", "page_count": 1}),
        ):
            res = client.post(
                "/api/v1/convert",
                data={"target": "html"},
                files={"file": ("note.txt", b"hello", "text/plain")},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["target"], "html")
        self.assertEqual(body["filename"], "note.html")
        self.assertEqual(body["markdown"], "# Hello")
        self.assertIn("<html", body["content"])
        self.assertIn("Hello", body["content"])
        self.assertEqual(body["engine"], "FileWorks")
        self.assertEqual(body["credits_used"], 1)
        self.assertNotIn("s3_key", body)

    def test_download_flag_returns_file(self) -> None:
        principal = _api_principal()
        client = TestClient(_app(principal))
        with patch(
            "app.api.v1.convert.run_conversion",
            new=AsyncMock(return_value={"markdown": "# Hello", "engine": "text", "page_count": 1}),
        ):
            res = client.post(
                "/api/v1/convert",
                data={"target": "txt", "download": "true"},
                files={"file": ("note.md", b"# Hello", "text/markdown")},
            )
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/plain", res.headers["content-type"])
        self.assertIn("attachment", res.headers["content-disposition"])
        self.assertIn(b"Hello", res.content)

    def test_download_docx_and_reject_image_output(self) -> None:
        principal = _api_principal()
        client = TestClient(_app(principal))
        with patch(
            "app.api.v1.convert.run_conversion",
            new=AsyncMock(return_value={"markdown": "# Hello", "engine": "text", "page_count": 1}),
        ):
            docx = client.post(
                "/api/v1/convert",
                data={"target": "docx", "download": "true"},
                files={"file": ("note.md", b"# Hello", "text/markdown")},
            )
            png = client.post(
                "/api/v1/convert",
                data={"target": "png", "download": "true"},
                files={"file": ("note.md", b"# Hello", "text/markdown")},
            )
        self.assertEqual(docx.status_code, 200)
        self.assertTrue(docx.content.startswith(b"PK"))
        self.assertIn("attachment", docx.headers["content-disposition"])
        self.assertEqual(png.status_code, 400)
