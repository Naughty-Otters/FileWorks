from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient
from PIL import Image

from app.auth.google import verify_google_id_token
from app.core.config import Settings, get_settings
from app.db.session import get_db, get_engine, init_db, session_scope
from app.db.upgrade import main as upgrade_main, upgrade_db
from app.engines.llm.engine import LLMEngine
from app.engines.llm.media import encode_image_file
from app.engines.llm.providers import clean_markdown, get_api_provider
from app.engines.llm.providers.base import (
    ConvertRequest,
    LLMClientError,
    anthropic_document_parts,
    chat_kwargs,
    invoke_markdown,
    openai_vision_parts,
)
from app.engines.paddle_structure import PaddleStructureEngine
from app.engines.registry import EngineRegistry, FixedEngineStrategy
from app.lambda_worker import handler
from app.main import create_app
from app.processing.reading.llm import LLMReader
from app.processing.models import SourceFile
from app.services.ocr import OCRService, dump_json, get_ocr_service
from app.services.options import ExtractOptions
from app.storage import get_document_store
from app.storage.s3 import S3DocumentStore, sanitize_filename, sanitize_user_id


class FakeBody:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data


class FakeS3:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_object(self, **kwargs):
        body = kwargs["Body"]
        if isinstance(body, str):
            body = body.encode()
        self.objects[(kwargs["Bucket"], kwargs["Key"])] = body

    def get_object(self, **kwargs):
        key = (kwargs["Bucket"], kwargs["Key"])
        if key not in self.objects:
            exc = Exception("missing")
            exc.response = {"Error": {"Code": "NoSuchKey"}}  # type: ignore[attr-defined]
            raise exc
        return {"Body": FakeBody(self.objects[key])}

    def generate_presigned_url(self, *_a, **_k) -> str:
        return "https://s3.example/signed"

    def get_paginator(self, _name: str):
        store = self

        class Paginator:
            def paginate(self, **kwargs):
                prefix = kwargs.get("Prefix", "")
                delimiter = kwargs.get("Delimiter")
                bucket = kwargs["Bucket"]
                keys = [k for (b, k) in store.objects if b == bucket and k.startswith(prefix)]
                if delimiter:
                    prefixes = set()
                    for key in keys:
                        rest = key[len(prefix) :]
                        if delimiter in rest:
                            prefixes.add(prefix + rest.split(delimiter)[0] + delimiter)
                    yield {"CommonPrefixes": [{"Prefix": p} for p in prefixes]}
                else:
                    yield {"Contents": [{"Key": k} for k in keys]}

        return Paginator()

    def delete_objects(self, **kwargs):
        for obj in kwargs["Delete"]["Objects"]:
            self.objects.pop((kwargs["Bucket"], obj["Key"]), None)


class S3StoreTests(unittest.TestCase):
    def test_sanitize(self) -> None:
        self.assertEqual(sanitize_user_id("anonuser1"), "anonuser1")
        with self.assertRaises(ValueError):
            sanitize_user_id("bad id")
        self.assertEqual(sanitize_filename("../x.png"), "x.png")

    def test_get_upload_bytes_reads_the_uploads_bucket(self) -> None:
        """POST /extract with an s3_key reads presigned uploads, which live in their own bucket."""
        store = S3DocumentStore(bucket="docs", prefix="fw", region="us-west-2", upload_bucket="uploads")
        fake = FakeS3()
        store._client = fake
        key = store.upload_object_key("anonuser1", "doc1", "photo.png")
        store.put_bytes(key, b"png-bytes", "image/png")
        self.assertIn(("uploads", key), fake.objects)
        self.assertEqual(store.get_upload_bytes(key), b"png-bytes")
        self.assertIsNone(store.get_upload_bytes(store.upload_object_key("anonuser1", "doc1", "gone.png")))

    def test_roundtrip(self) -> None:
        store = S3DocumentStore(bucket="docs", prefix="fw", region="us-west-2", upload_bucket="uploads")
        fake = FakeS3()
        store._client = fake
        key = store.upload_object_key("anonuser1", "doc1", "photo.png")
        self.assertTrue(store.is_upload_key(key))
        url, headers = store.presign_put(key, "image/png")
        self.assertIn("https://", url)
        self.assertEqual(headers["Content-Type"], "image/png")
        rec = store.save_document(
            document_id="doc1",
            filename="photo.png",
            content_type="image/png",
            source_bytes=b"png",
            source_suffix=".png",
            engine="ocr",
            page_count=1,
            output_format="both",
            markdown="# hi",
            json_data={"a": 1},
            pages=[],
            owner_id="u1",
        )
        loaded = store.get_document("doc1")
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.filename, "photo.png")
        listed = store.list_documents()
        self.assertEqual(listed[0].id, "doc1")
        source = store.get_source_bytes("doc1")
        self.assertEqual(source[0], b"png")
        store.save_media_files("doc1", [("0.jpg", b"jpeg", "image/jpeg"), ("bad.exe", b"x", "x")])
        media = store.load_media_files("doc1")
        self.assertIn("0.jpg", media)
        self.assertTrue(store.delete_document("doc1"))
        self.assertTrue(store.presign_get(store.object_key(rec.source_key), filename="photo.png", content_type="image/png"))

    def test_factory_local(self) -> None:
        get_document_store.cache_clear()
        store = get_document_store()
        self.assertEqual(store.backend_name, "local")
        get_document_store.cache_clear()


class LLMEngineTests(unittest.TestCase):
    def test_unconfigured(self) -> None:
        settings = Settings(
            _env_file=None,
            llm_provider=None,
            llm_api_key=None,
            openai_api_key=None,
            jwt_secret="test-secret-do-not-use-in-prod-please",
        )
        engine = LLMEngine(settings)
        self.assertFalse(engine.configured())
        self.assertIsNotNone(engine.init_error)
        with self.assertRaises(RuntimeError):
            engine.ensure_ready()
        desc = engine.describe()
        self.assertFalse(desc["ready"])

    def test_extract_mocked(self) -> None:
        from app.core.config import Settings

        settings = Settings(
            llm_provider="openai",
            llm_api_key="sk-test",
            jwt_secret="test-secret-do-not-use-in-prod-please",
        )
        engine = LLMEngine(settings)
        self.assertTrue(engine.configured())
        with NamedTemporaryFile(suffix=".png") as handle:
            Image.new("RGB", (32, 32), (1, 2, 3)).save(handle.name)
            with patch.object(engine, "_convert_pages", return_value=["# doc"]):
                result = engine.extract(Path(handle.name), output_format="both")
        self.assertEqual(result.markdown, "# doc")
        self.assertEqual(result.page_count, 1)

    def test_clean_markdown_and_providers(self) -> None:
        self.assertEqual(clean_markdown("```markdown\nHi\n```"), "Hi")
        self.assertEqual(get_api_provider("openai").id, "openai")
        with self.assertRaises(ValueError):
            get_api_provider("nope")

    def test_chat_helpers(self) -> None:
        spec = get_api_provider("openai")
        settings = get_settings()
        from app.engines.llm.catalog import get_provider_spec
        from app.engines.llm.urls import resolve_http_target

        request = ConvertRequest(
            spec=get_provider_spec("openai"),
            file_path=Path("a.png"),
            suffix=".png",
            api_key="k",
            model="gpt-4o",
            max_tokens=10,
            timeout_s=1,
            target=resolve_http_target(settings, get_provider_spec("openai")),
            max_pages=1,
            max_image_side=64,
        )
        kwargs = chat_kwargs(request, extra={"foo": 1})
        self.assertEqual(kwargs["foo"], 1)
        with NamedTemporaryFile(suffix=".png") as handle:
            Image.new("RGB", (40, 20), (9, 9, 9)).save(handle.name)
            request = ConvertRequest(
                spec=request.spec,
                file_path=Path(handle.name),
                suffix=".png",
                api_key="k",
                model="gpt-4o",
                max_tokens=10,
                timeout_s=1,
                target=request.target,
                max_pages=1,
                max_image_side=32,
            )
            parts = openai_vision_parts(request)
            self.assertEqual(parts[0]["type"], "text")
            encoded = encode_image_file(Path(handle.name), max_side=16)
            self.assertEqual(encoded[1], "image/jpeg")
        pdf_req = ConvertRequest(
            spec=get_provider_spec("claude"),
            file_path=Path("a.pdf"),
            suffix=".pdf",
            api_key="k",
            model="c",
            max_tokens=10,
            timeout_s=1,
            target=request.target,
            max_pages=1,
            max_image_side=32,
        )
        with NamedTemporaryFile(suffix=".pdf") as handle:
            Path(handle.name).write_bytes(b"%PDF-1.4")
            pdf_req = ConvertRequest(
                spec=pdf_req.spec,
                file_path=Path(handle.name),
                suffix=".pdf",
                api_key="k",
                model="c",
                max_tokens=10,
                timeout_s=1,
                target=request.target,
                max_pages=1,
                max_image_side=32,
            )
            parts = anthropic_document_parts(pdf_req)
            self.assertEqual(parts[1]["type"], "document")
            gemini_parts = get_api_provider("gemini").build_parts(
                ConvertRequest(
                    spec=get_provider_spec("gemini"),
                    file_path=Path(handle.name),
                    suffix=".pdf",
                    api_key="k",
                    model="gemini-2.5-flash",
                    max_tokens=10,
                    timeout_s=1,
                    target=request.target,
                    max_pages=1,
                    max_image_side=32,
                )
            )
            self.assertEqual(gemini_parts[1]["type"], "file")
            self.assertEqual(gemini_parts[1]["mime_type"], "application/pdf")

        class Model:
            def invoke(self, _msgs):
                return SimpleNamespace(content="hello")

        self.assertEqual(invoke_markdown(Model(), [{"type": "text", "text": "x"}]), "hello")

        class Empty:
            def invoke(self, _msgs):
                return SimpleNamespace(content="  ")

        with self.assertRaises(LLMClientError):
            invoke_markdown(Empty(), [])

    def test_provider_build_chat_model(self) -> None:
        from app.engines.llm.catalog import get_provider_spec
        from app.engines.llm.urls import resolve_http_target

        settings = get_settings()
        spec = get_provider_spec("openai")
        request = ConvertRequest(
            spec=spec,
            file_path=Path("a.png"),
            suffix=".png",
            api_key="k",
            model="m",
            max_tokens=8,
            timeout_s=1,
            target=resolve_http_target(settings, spec),
            max_pages=1,
            max_image_side=32,
        )
        fake = MagicMock(name="Chat")
        modules = {
            "langchain_openai": MagicMock(ChatOpenAI=fake),
            "langchain_anthropic": MagicMock(ChatAnthropic=fake),
            "langchain_deepseek": MagicMock(ChatDeepSeek=fake),
            "langchain_fireworks": MagicMock(ChatFireworks=fake),
            "langchain_xai": MagicMock(ChatXAI=fake),
            "langchain_openrouter": MagicMock(ChatOpenRouter=fake),
            "langchain_moonshot": MagicMock(ChatMoonshot=fake),
            "langchain_google_genai": MagicMock(ChatGoogleGenerativeAI=fake),
        }
        with patch.dict("sys.modules", modules):
            for provider_id in ("openai", "claude", "deepseek", "fireworks", "grok", "openrouter", "kimi", "glm", "gemini"):
                get_api_provider(provider_id).build_chat_model(request)
        self.assertTrue(fake.called)

    def test_llm_reader_unconfigured(self) -> None:
        settings = Settings(
            _env_file=None,
            llm_provider=None,
            llm_api_key=None,
            openai_api_key=None,
            jwt_secret="test-secret-do-not-use-in-prod-please",
        )
        with patch("app.processing.reading.llm.get_settings", return_value=settings):
            reader = LLMReader()
            source = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
            self.assertFalse(reader.can_process(source).supported)
            desc = reader.describe()
        self.assertEqual(desc["id"], "llm")


class StructureEngineTests(unittest.TestCase):
    def test_extract_mocked(self) -> None:
        engine = PaddleStructureEngine(get_settings())
        engine._pipeline = SimpleNamespace(
            predict=lambda path, **kwargs: [
                SimpleNamespace(
                    json={"parsing_res_list": [{"block_bbox": [0, 0, 2, 2], "block_content": "Hi", "block_label": "text"}]},
                    markdown="# Hi",
                )
            ]
        )
        result = engine.extract(Path(__file__), output_format="both")
        self.assertIn("Hi", result.markdown or "")
        engine.ensure_ready()

    def test_predict_filtered(self) -> None:
        engine = PaddleStructureEngine(get_settings())

        def predict(path, **kwargs):
            if kwargs:
                raise TypeError("no kwargs")
            return [SimpleNamespace(json={"text": "x"}, markdown="x")]

        engine._pipeline = SimpleNamespace(predict=predict)
        out = engine._predict_filtered("p", {"use_table_recognition": True})
        self.assertEqual(len(out), 1)


class OCRServiceTests(unittest.TestCase):
    def test_describe_and_extract_fallback(self) -> None:
        service = OCRService(get_settings())
        self.assertTrue(service.list_engines())
        self.assertFalse(service.ready)
        failing = MagicMock()
        failing.id = "structure"
        failing.extract.side_effect = RuntimeError("boom")
        ok = MagicMock()
        ok.id = "ocr"
        ok.extract.return_value = SimpleNamespace(to_dict=lambda: {"markdown": "ok"})
        service.registry.get = MagicMock(side_effect=lambda eid: failing if eid == "structure" else ok)
        service.registry.select_engine = MagicMock(return_value=failing)
        payload = service.extract(Path("a.png"))
        self.assertEqual(payload["markdown"], "ok")
        self.assertIn("a", dump_json({"a": 1}))

    def test_ensure_loaded_fallback(self) -> None:
        service = OCRService(get_settings())
        failing = MagicMock()
        failing.id = "structure"
        failing.ensure_ready.side_effect = RuntimeError("no")
        ok = MagicMock()
        ok.id = "ocr"
        ok.ensure_ready.return_value = None
        service.registry.select_engine = MagicMock(return_value=failing)
        service.registry.get = MagicMock(return_value=ok)
        service.ensure_loaded()
        self.assertEqual(service._last_engine_id, "ocr")

    def test_registry_aliases(self) -> None:
        registry = EngineRegistry(get_settings(), selection=FixedEngineStrategy("pp-ocr"))
        self.assertEqual(registry.resolve_id("ppocr"), "ocr")
        self.assertEqual(registry.select_engine().id, "ocr")
        with self.assertRaises(ValueError):
            registry.get("nope")


class LambdaAndAppTests(unittest.TestCase):
    def test_handler_success(self) -> None:
        s3 = MagicMock()
        s3.get_object.return_value = {"Body": FakeBody(b"png")}
        with patch("boto3.client", return_value=s3), patch(
            "app.services.convert.convert_document", return_value={"markdown": "hi"}
        ):
            out = handler(
                {
                    "action": "convert",
                    "bucket": "b",
                    "key": "k.png",
                    "filename": "k.png",
                    "result_key": "out.json",
                    "options": {},
                },
                None,
            )
        self.assertTrue(out["ok"])

    def test_handler_bad_action(self) -> None:
        out = handler({"action": "nope", "bucket": "b", "key": "k", "result_key": "r"}, None)
        self.assertFalse(out["ok"])

    def test_create_app(self) -> None:
        with patch("app.db.session.init_db"), patch("app.storage.get_document_store"):
            app = create_app()
        self.assertEqual(app.title, get_settings().app_name)

    def test_cors_origin_regex_allows_preview_hosts(self) -> None:
        """Pages preview hosts change every deploy; the regex covers them without an apply."""
        settings = get_settings()
        preview = "https://a560669e.fileworks-staging.pages.dev"
        with patch.object(
            settings,
            "cors_origin_regex",
            r"^https://([a-z0-9-]+\.)?fileworks-staging\.pages\.dev$",
        ):
            with patch("app.db.session.init_db"), patch("app.storage.get_document_store"):
                app = create_app()
            res = TestClient(app).options(
                "/api/health",
                headers={"Origin": preview, "Access-Control-Request-Method": "GET"},
            )
        self.assertEqual(res.headers.get("access-control-allow-origin"), preview)

    def test_cors_allows_staging_public_host(self) -> None:
        settings = get_settings()
        origin = "https://staging.fileworks.ai"
        with patch.object(
            settings,
            "cors_origin_regex",
            r"^https://(([a-z0-9-]+\.)?fileworks-staging\.pages\.dev|(www\.)?staging\.fileworks\.ai)$",
        ):
            with patch("app.db.session.init_db"), patch("app.storage.get_document_store"):
                app = create_app()
            res = TestClient(app).options(
                "/api/health",
                headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
            )
        self.assertEqual(res.headers.get("access-control-allow-origin"), origin)

    def test_cors_rejects_unrelated_origin(self) -> None:
        with patch("app.db.session.init_db"), patch("app.storage.get_document_store"):
            app = create_app()
        res = TestClient(app).options(
            "/api/health",
            headers={"Origin": "https://evil.example.com", "Access-Control-Request-Method": "GET"},
        )
        self.assertIsNone(res.headers.get("access-control-allow-origin"))

    def test_unhandled_error_keeps_cors_headers(self) -> None:
        """A crash must not read as a CORS failure, or the UI blames the network."""
        origin = "http://localhost:3000"
        with patch("app.db.session.init_db"), patch("app.storage.get_document_store"):
            app = create_app()

        @app.get("/api/boom")
        def _boom() -> None:
            raise RuntimeError("kaboom")

        res = TestClient(app).get("/api/boom", headers={"Origin": origin})
        self.assertEqual(res.status_code, 500)
        self.assertEqual(res.headers.get("access-control-allow-origin"), origin)

    def test_private_network_preflight_header(self) -> None:
        with patch("app.db.session.init_db"), patch("app.storage.get_document_store"):
            app = create_app()
        client = TestClient(app)
        res = client.options(
            "/api/billing/checkout",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        self.assertEqual(res.headers.get("access-control-allow-origin"), "http://localhost:3000")
        self.assertEqual(res.headers.get("access-control-allow-private-network"), "true")

    def test_google_requires_client(self) -> None:
        with self.assertRaises(RuntimeError):
            verify_google_id_token("tok")

    def test_db_without_url(self) -> None:
        self.assertIsNone(get_engine())
        init_db()
        self.assertIsNone(session_scope())
        gen = get_db()
        self.assertIsNone(next(gen))
        self.assertEqual(upgrade_main(["current"]), 1)
        upgrade_db()


if __name__ == "__main__":
    unittest.main()
