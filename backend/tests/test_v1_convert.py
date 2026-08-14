from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1 import router as v1_router
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.db.session import get_db


def _app(principal: Principal) -> FastAPI:
    app = FastAPI()
    app.include_router(v1_router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_db] = lambda: None
    return app


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
        self.assertEqual(target_ids, ["markdown", "txt", "html", "json", "pdf"])
        pdf = next(item for item in body["targets"] if item["id"] == "pdf")
        self.assertFalse(pdf["available"])
        option_names = [item["name"] for item in body["options"]]
        self.assertIn("use_ai", option_names)
        self.assertIn("prefer_structure", option_names)
        self.assertIn("target_lang", option_names)
        self.assertIn("use_table_recognition", option_names)
        self.assertFalse(body["capabilities"]["ai"])
        self.assertFalse(body["capabilities"]["translate"])

    def test_guest_cannot_convert(self) -> None:
        principal = Principal(plan=get_plan("anonymous"), anonymous_id="anon")
        client = TestClient(_app(principal))
        res = client.post(
            "/api/v1/convert",
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["detail"]["feature"], "extract")

    def test_rejects_s3_key_only_request(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        res = client.post("/api/v1/convert", data={"s3_key": "uploads/foo.pdf"})
        self.assertEqual(res.status_code, 422)

    def test_rejects_unknown_target_with_available_list(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        res = client.post(
            "/api/v1/convert",
            data={"target": "docx"},
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
        self.assertEqual(res.status_code, 400)
        detail = res.json()["detail"]
        self.assertEqual(detail["code"], "unsupported_target")
        self.assertIn("markdown", detail["available"])
        self.assertNotIn("pdf", detail["available"])

    def test_rejects_pdf_target(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        res = client.post(
            "/api/v1/convert",
            data={"target": "pdf"},
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["detail"]["code"], "unsupported_target")

    def test_rejects_use_ai_when_unavailable(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        res = client.post(
            "/api/v1/convert",
            data={"use_ai": "true"},
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["detail"]["code"], "option_unavailable")
        self.assertEqual(res.json()["detail"]["field"], "use_ai")

    def test_one_shot_returns_html(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        with patch(
            "app.api.v1.convert.convert_document",
            return_value={"markdown": "# Hello", "engine": "text", "page_count": 1},
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
        self.assertNotIn("s3_key", body)

    def test_download_flag_returns_file(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        with patch(
            "app.api.v1.convert.convert_document",
            return_value={"markdown": "# Hello", "engine": "text", "page_count": 1},
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
