from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.routes import (
    _form_bool,
    _health_payload,
    _regions_payload,
    _validate_filename,
    _validate_upload_bytes,
    content_disposition,
    router,
)
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.core.config import get_settings
from app.engines.paddle_ocr import PaddleOCREngine
from app.processing.models import DocumentOutput, OutputKind, ReadResult
from app.processing.postprocess.translate import MarkdownTranslator, _split_markdown
from app.processing.remote_llm import invoke_remote_convert, needs_remote_llm
from app.services.convert import convert_document
from app.services.export import export_markdown
from app.services.options import ExtractOptions


def _guest_app() -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: Principal(
        plan=get_plan("anonymous"), anonymous_id="anonuser1"
    )
    return app


class RouteHelperTests(unittest.TestCase):
    def test_content_disposition(self) -> None:
        header = content_disposition("attachment", "报告.pdf")
        self.assertIn("filename=", header)
        self.assertIn("UTF-8", header)

    def test_validate_filename(self) -> None:
        self.assertEqual(_validate_filename("a.PDF"), ".pdf")
        with self.assertRaises(HTTPException):
            _validate_filename("a.exe")

    def test_validate_upload_bytes(self) -> None:
        name, suffix = _validate_upload_bytes("a.png", b"abc", "image/png")
        self.assertEqual(suffix, ".png")
        with self.assertRaises(HTTPException):
            _validate_upload_bytes("a.png", b"", "image/png")
        with self.assertRaises(HTTPException):
            _validate_upload_bytes("a.png", b"x" * (51 * 1024 * 1024), "image/png")

    def test_form_bool(self) -> None:
        self.assertTrue(_form_bool("true"))
        self.assertFalse(_form_bool("0"))
        self.assertTrue(_form_bool(True))
        self.assertTrue(_form_bool("ON"))

    def test_regions_from_pages(self) -> None:
        regions, size = _regions_payload(
            {},
            [{"page": 1, "json": {"parsing_res_list": [{"block_bbox": [0, 0, 2, 2], "block_content": "x"}]}}],
        )
        self.assertEqual(len(regions), 1)
        self.assertIsNone(size)


class HealthRouteTests(unittest.TestCase):
    def _service(self) -> MagicMock:
        svc = MagicMock()
        svc.ready = False
        svc.mode = "ocr"
        svc.init_error = "not loaded"
        provider = MagicMock()
        provider.ready = False
        provider.init_error = "cold"
        svc.registry.get.return_value = provider
        svc.list_engines.return_value = [
            {
                "id": "ocr",
                "label": "OCR",
                "ready": False,
                "configured": True,
                "active": True,
                "error": None,
                "option_support": {},
            }
        ]
        return svc

    def test_health_and_options(self) -> None:
        client = TestClient(_guest_app())
        pipeline = MagicMock()
        pipeline.list_readers.return_value = [
            {"id": "anydoc", "label": "AnyDoc"},
            {"id": "ocr", "label": "OCR"},
            {"id": "llm", "label": "LLM", "configured": False, "supports_vision": False, "error": "off"},
        ]
        translator = SimpleNamespace(
            configured=lambda: False,
            init_error="off",
            spec=None,
            describe=lambda: {"ready": False, "configured": False, "error": "off", "label": "Translate"},
        )
        with patch("app.api.routes.get_ocr_service", return_value=self._service()), patch(
            "app.api.routes.get_markdown_translator", return_value=translator
        ), patch("app.api.routes.anydoc_is_available", return_value=True), patch(
            "app.api.routes.get_document_pipeline", return_value=pipeline
        ):
            res = client.get("/api/health")
            self.assertEqual(res.status_code, 200)
            opts = client.get("/api/options")
            self.assertEqual(opts.status_code, 200)
            engines = client.get("/api/engines")
            self.assertEqual(engines.status_code, 200)

    def test_warmup_degraded(self) -> None:
        client = TestClient(_guest_app())
        svc = self._service()
        svc.ensure_loaded.side_effect = RuntimeError("models missing")
        pipeline = MagicMock()
        pipeline.list_readers.return_value = []
        translator = SimpleNamespace(describe=lambda: {"ready": False, "configured": False, "error": "off"})
        with patch("app.api.routes.get_ocr_service", return_value=svc), patch(
            "app.api.routes.get_markdown_translator", return_value=translator
        ), patch("app.api.routes.get_document_pipeline", return_value=pipeline):
            res = client.post("/api/warmup")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json()["status"], "degraded")

    def test_health_payload_remote_lambda(self) -> None:
        settings = get_settings()
        object.__setattr__(settings, "llm_lambda_function", "fn") if False else None
        settings.llm_lambda_function = "fn"
        svc = self._service()
        pipeline = MagicMock()
        pipeline.list_readers.return_value = [{"id": "llm", "label": "LLM", "configured": True, "supports_vision": True}]
        translator = SimpleNamespace(describe=lambda: {"ready": False, "configured": False, "error": "off"})
        with patch("app.api.routes.get_document_pipeline", return_value=pipeline), patch(
            "app.api.routes.get_markdown_translator", return_value=translator
        ):
            payload = _health_payload(status="ok", settings=settings, service=svc)
        self.assertTrue(payload.llm_ready)
        settings.llm_lambda_function = ""


class ExportRouteTests(unittest.TestCase):
    def test_export_markdown(self) -> None:
        client = TestClient(_guest_app())
        res = client.post("/api/export", json={"markdown": "# Hi", "format": "txt", "filename": "doc"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.content)

    def test_export_bad_format(self) -> None:
        client = TestClient(_guest_app())
        res = client.post("/api/export", json={"markdown": "# Hi", "format": "exe"})
        self.assertIn(res.status_code, {400, 422})

    def test_guest_history_empty(self) -> None:
        client = TestClient(_guest_app())
        res = client.get("/api/history")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["items"], [])

    def test_presign_not_enabled(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        app = FastAPI()
        app.include_router(router, prefix="/api")
        app.dependency_overrides[get_principal] = lambda: Principal(
            plan=get_plan("basic"), user=user  # type: ignore[arg-type]
        )
        client = TestClient(app)
        res = client.post(
            "/api/uploads/presign",
            json={"filename": "a.png", "content_type": "image/png", "size_bytes": 10, "user_id": str(user.id)},
        )
        self.assertEqual(res.status_code, 501)

    def test_presign_forbidden_for_guest(self) -> None:
        client = TestClient(_guest_app())
        res = client.post(
            "/api/uploads/presign",
            json={"filename": "a.png", "content_type": "image/png", "size_bytes": 10, "user_id": "anonuser1"},
        )
        self.assertEqual(res.status_code, 403)


class TranslateTests(unittest.TestCase):
    def test_not_configured(self) -> None:
        translator = MarkdownTranslator(get_settings())
        self.assertFalse(translator.configured())
        self.assertIn("TRANSLATE", translator.init_error or "")
        self.assertEqual(translator.translate_markdown("hi", ""), "hi")
        self.assertEqual(translator.translate_markdown("", "en"), "")
        with self.assertRaises(RuntimeError):
            translator.translate_markdown("hi", "en")

    def test_split_markdown(self) -> None:
        chunks = _split_markdown("aaaa\n\nbbbb\n\ncccc", max_chars=6)
        self.assertGreaterEqual(len(chunks), 2)
        self.assertEqual(_split_markdown("short", max_chars=100), ["short"])

    def test_apply_passthrough(self) -> None:
        translator = MarkdownTranslator(get_settings())
        result = ReadResult(
            engine_id="e",
            engine_label="E",
            outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="hi")],
        )
        self.assertEqual(translator.apply(result, "original").markdown(), "hi")

    def test_apply_with_mocked_provider(self) -> None:
        settings = get_settings()
        settings.translate_provider = "openai"
        settings.translate_api_key = "sk-test"
        translator = MarkdownTranslator(settings)
        provider = MagicMock()
        provider.complete_text.return_value = "hola"
        result = ReadResult(
            engine_id="e",
            engine_label="E",
            outputs=[DocumentOutput(kind=OutputKind.TEXT, content="hi")],
        )
        with patch("app.processing.postprocess.translate.get_api_provider", return_value=provider):
            updated = translator.apply(result, "es")
        self.assertEqual(updated.markdown(), "hola")
        settings.translate_provider = ""
        settings.translate_api_key = None


class ConvertFacadeTests(unittest.TestCase):
    def test_convert_and_export_facades(self) -> None:
        with patch("app.services.convert.get_document_pipeline") as pipe:
            pipe.return_value.process.return_value = {"markdown": "x"}
            out = convert_document(Path("a.txt"), filename="a.txt")
            self.assertEqual(out["markdown"], "x")
        data, media, ext = export_markdown("# H", fmt="md")
        self.assertEqual(ext, "md")
        self.assertTrue(data)


class RemoteLlmTests(unittest.TestCase):
    def test_needs_remote_off(self) -> None:
        self.assertFalse(needs_remote_llm(ExtractOptions(use_ai=True)))

    def test_needs_remote_on(self) -> None:
        settings = get_settings()
        settings.llm_lambda_function = "fn"
        self.assertTrue(needs_remote_llm(ExtractOptions(use_ai=True)))
        settings.llm_lambda_function = ""

    def test_invoke_remote_success(self) -> None:
        settings = get_settings()
        settings.llm_lambda_function = "fn"
        settings.s3_bucket = "b"
        settings.s3_region = "us-west-2"

        class Payload:
            def read(self) -> bytes:
                return b'{"ok": true, "bucket": "b", "key": "out.json"}'

        lambda_client = MagicMock()
        lambda_client.invoke.return_value = {"Payload": Payload()}
        s3 = MagicMock()
        s3.get_object.return_value = {"Body": SimpleNamespace(read=lambda: b'{"markdown":"hi"}')}

        def client(name, **kwargs):
            return lambda_client if name == "lambda" else s3

        with patch("boto3.client", side_effect=client):
            parsed = invoke_remote_convert(
                bucket="b",
                key="k",
                filename="a.png",
                content_type="image/png",
                output_format="both",
                options=ExtractOptions(),
            )
        self.assertEqual(parsed["markdown"], "hi")
        settings.llm_lambda_function = ""
        settings.s3_bucket = None

    def test_invoke_requires_function(self) -> None:
        with self.assertRaises(RuntimeError):
            invoke_remote_convert(
                bucket="b",
                key="k",
                filename="a.png",
                content_type="image/png",
                output_format="both",
                options=ExtractOptions(),
            )


class PaddleHelperTests(unittest.TestCase):
    def test_format_and_bbox(self) -> None:
        opts = ExtractOptions(format_block_content=True, use_formula_recognition=True)
        md = PaddleOCREngine._format_texts(["Hello."], opts)
        self.assertIn("Hello", md)
        noted = PaddleOCREngine._append_option_sections("body", opts)
        self.assertIn("Formula", noted)
        self.assertEqual(PaddleOCREngine._as_bbox([0, 0, 10, 10]), [0, 0, 10, 10])
        self.assertIsNone(PaddleOCREngine._as_bbox([0, 0, 0, 1]))
        poly = PaddleOCREngine._as_bbox([[0, 0], [4, 0], [4, 3], [0, 3]])
        self.assertEqual(poly, [0.0, 0.0, 4.0, 3.0])
        regions, size = PaddleOCREngine._regions_from_ocr_json(
            {"width": 10, "height": 8, "rec_texts": ["a|b|c"], "rec_boxes": [[0, 0, 5, 5]]},
            page=1,
            options=ExtractOptions(use_table_recognition=True),
        )
        self.assertEqual(size["width"], 10)
        self.assertEqual(regions[0]["label"], "table")
        empty = PaddleOCREngine._format_texts([], ExtractOptions(format_block_content=False))
        self.assertEqual(empty, "")
        self.assertTrue(PaddleOCREngine._needs_structure_enrichment(ExtractOptions(use_seal_recognition=True)))
        self.assertIsNone(PaddleOCREngine._as_bbox("nope"))


class PrincipalTests(unittest.TestCase):
    def test_anonymous_principal(self) -> None:
        class Req:
            headers = {"x-anonymous-id": "abc"}

        principal = get_principal(Req(), db=None)  # type: ignore[arg-type]
        self.assertEqual(principal.plan.id, "anonymous")
        self.assertEqual(principal.anonymous_id, "abc")
        self.assertIsNone(principal.user_id)
        self.assertFalse(principal.permissions()["extract.ai"])

    def test_invalid_bearer(self) -> None:
        class Req:
            headers = {"authorization": "Bearer not-a-jwt"}

        with self.assertRaises(HTTPException):
            get_principal(Req(), db=object())  # type: ignore[arg-type]

    def test_valid_token_missing_user(self) -> None:
        from app.auth.tokens import issue_access_token

        token = issue_access_token(user_id=uuid4(), plan="pro", email="a@b.co")

        class Req:
            headers = {"authorization": f"Bearer {token}"}

        db = MagicMock()
        db.get.return_value = None
        with self.assertRaises(HTTPException) as ctx:
            get_principal(Req(), db=db)  # type: ignore[arg-type]
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
