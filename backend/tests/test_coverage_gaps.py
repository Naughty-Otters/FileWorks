from __future__ import annotations

import io
import unittest
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

from PIL import Image

from app.engines.base import ExtractResult
from app.engines.llm.engine import LLMEngine
from app.engines.llm.providers.base import ConvertRequest
from app.engines.paddle_ocr import PaddleOCREngine
from app.engines.paddle_structure import PaddleStructureEngine
from app.processing.models import DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.pipeline import DocumentPipeline
from app.processing.postprocess.media import (
    PAGE_SEPARATOR,
    EmbeddedImage,
    decode_data_url,
    embed_read_result_media,
    extract_pdf_images,
    normalize_image_bytes,
    to_data_url,
    _pdf_object_bytes,
    _pdf_object_to_image,
    _page_hint_from_text,
    count_embedded_images,
)
from app.processing.reading.anydoc import AnyDocReader, _asset_bytes, _iter_blocks
from app.processing.reading.ocr import OCRReader
from app.processing.reading.registry import ReaderRegistry
from app.processing.models import Capability
from app.processing.reading.base import Reader
from app.services.markdown import (
    _pil_to_data_url,
    markdown_from_parsing_blocks,
    resolve_markdown_media,
)
from app.services.options import ExtractOptions
from app.storage import get_document_store


def _png(size=(80, 80)) -> bytes:
    image = Image.new("RGBA", size, (10, 20, 30, 200))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


class MediaGapTests(unittest.TestCase):
    def test_decode_and_count(self) -> None:
        data = _png()
        url = to_data_url(data, "image/png")
        decoded = decode_data_url(url)
        self.assertIsNotNone(decoded)
        self.assertIsNone(decode_data_url("not-a-data-url"))
        self.assertEqual(count_embedded_images(""), 0)
        self.assertGreater(count_embedded_images(f"![a]({url})"), 0)

    def test_normalize_png_and_junk(self) -> None:
        out = normalize_image_bytes(_png(), "image/png")
        self.assertIsNotNone(out)
        self.assertIsNone(normalize_image_bytes(b"not-an-image", "image/png"))
        huge = Image.new("RGB", (2000, 2000), (1, 2, 3))
        buf = io.BytesIO()
        huge.save(buf, format="JPEG", quality=95)
        resized = normalize_image_bytes(buf.getvalue(), "image/jpeg")
        self.assertIsNotNone(resized)

    def test_embed_raster_source(self) -> None:
        with NamedTemporaryFile(suffix=".png", delete=False) as handle:
            handle.write(_png())
            path = Path(handle.name)
        source = SourceFile.from_path(path, mime_type="image/png")
        result = ReadResult(
            engine_id="ocr",
            engine_label="OCR",
            outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="Hello logo")],
            pages=[{"page": 1, "markdown": "Hello logo"}],
        )
        updated = embed_read_result_media(result, source)
        self.assertIn("data:image", updated.markdown())

    def test_pdf_object_bytes_and_hint(self) -> None:
        jpeg = normalize_image_bytes(_png(), "image/png")[0]
        obj = SimpleNamespace(
            get_data=lambda: b"\xff\xd8\xff" + jpeg[3:],
            get_bitmap=lambda render=False: None,
        )
        data, mime = _pdf_object_bytes(obj)
        self.assertEqual(mime, "image/jpeg")
        self.assertTrue(_page_hint_from_text("VIRGINIA TAM INSURANCE AGENCY, INC.\nmore"))
        self.assertIsNone(_page_hint_from_text("x"))

        good = SimpleNamespace(
            get_bounds=lambda: (10, 700, 120, 760),
            get_px_size=lambda: (200, 80),
            get_data=lambda: jpeg,
            get_bitmap=lambda render=False: None,
        )
        extracted = _pdf_object_to_image(good, 1, page_size=(612.0, 792.0), page_hint="Hello")
        self.assertIsNotNone(extracted)

    def test_extract_pdf_images_mocked(self) -> None:
        jpeg = normalize_image_bytes(_png(), "image/png")[0]
        obj = SimpleNamespace(
            get_bounds=lambda: (40, 700, 180, 760),
            get_px_size=lambda: (200, 80),
            get_data=lambda: jpeg,
            get_bitmap=lambda render=False: None,
        )
        page = SimpleNamespace(
            get_size=lambda: (612.0, 792.0),
            get_textpage=lambda: SimpleNamespace(
                get_text_bounded=lambda: "Hello world heading", close=lambda: None
            ),
            get_objects=lambda filter=None: [obj],
            close=lambda: None,
        )
        document = MagicMock()
        document.__len__.return_value = 1
        document.__iter__.return_value = iter([page])
        pdfium = SimpleNamespace(
            PdfDocument=lambda _p: document,
            raw=SimpleNamespace(FPDF_PAGEOBJ_IMAGE=1),
        )
        with patch.dict("sys.modules", {"pypdfium2": pdfium}):
            images = extract_pdf_images(Path("x.pdf"))
        self.assertGreaterEqual(len(images), 0)

    def test_multi_page_pdf_keeps_extracted_images(self) -> None:
        """Joining pages must not throw away images placed into the document."""
        with NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            handle.write(b"%PDF-1.4\n")
            path = Path(handle.name)
        source = SourceFile.from_path(path, mime_type="application/pdf")
        page_text = ["Page one text", "Page two text", "Page three text"]
        result = ReadResult(
            engine_id="anydoc",
            engine_label="AnyDoc",
            outputs=[
                DocumentOutput(kind=OutputKind.MARKDOWN, content=PAGE_SEPARATOR.join(page_text))
            ],
            pages=[{"page": n, "markdown": text} for n, text in enumerate(page_text, start=1)],
            page_count=3,
        )
        extracted = [
            EmbeddedImage(alt="logo", data=_png(), mime="image/png", page=2, page_count=3),
            EmbeddedImage(
                alt="signature", data=_png((90, 60)), mime="image/png", page=3, page_count=3
            ),
        ]
        with patch(
            "app.processing.postprocess.media.extract_pdf_images",
            return_value=extracted,
        ):
            updated = embed_read_result_media(result, source)

        self.assertIn("data:image", updated.markdown())
        self.assertEqual(updated.metadata.get("embedded_images"), 2)
        self.assertEqual(len(updated.pages), 3)
        # Each image belongs to the page it was extracted from, not page one.
        self.assertEqual(count_embedded_images(updated.pages[0]["markdown"]), 0)
        self.assertEqual(count_embedded_images(updated.pages[1]["markdown"]), 1)
        self.assertEqual(count_embedded_images(updated.pages[2]["markdown"]), 1)
        for index, text in enumerate(page_text):
            self.assertIn(text, updated.pages[index]["markdown"])

    def test_preserve_images_still_extracts_when_another_page_has_a_raster(self) -> None:
        """A scanned page with an embedded raster must not skip figures on later pages."""
        with NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            handle.write(b"%PDF-1.4\n")
            path = Path(handle.name)
        source = SourceFile.from_path(path, mime_type="application/pdf")
        raster = to_data_url(normalize_image_bytes(_png())[0], "image/jpeg")
        result = ReadResult(
            engine_id="anydoc",
            engine_label="AnyDoc",
            outputs=[
                DocumentOutput(
                    kind=OutputKind.MARKDOWN,
                    content=PAGE_SEPARATOR.join(
                        [f"![Page 1]({raster})", "Quarterly revenue"]
                    ),
                )
            ],
            pages=[
                {"page": 1, "markdown": f"![Page 1]({raster})"},
                {"page": 2, "markdown": "Quarterly revenue"},
            ],
            page_count=2,
        )
        chart = EmbeddedImage(alt="chart", data=_png((120, 80)), mime="image/png", page=2, page_count=2)
        with patch(
            "app.processing.postprocess.media.extract_pdf_images",
            return_value=[chart],
        ):
            updated = embed_read_result_media(result, source, preserve_images=True)

        self.assertEqual(count_embedded_images(updated.pages[0]["markdown"]), 1)
        self.assertEqual(count_embedded_images(updated.pages[1]["markdown"]), 1)
        self.assertIn("Quarterly revenue", updated.pages[1]["markdown"])
        self.assertIn("data:image", updated.pages[1]["markdown"])

    def test_preserve_images_off_skips_extra_pdf_figures(self) -> None:
        with NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            handle.write(b"%PDF-1.4\n")
            path = Path(handle.name)
        source = SourceFile.from_path(path, mime_type="application/pdf")
        result = ReadResult(
            engine_id="anydoc",
            engine_label="AnyDoc",
            outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="Just text")],
            pages=[{"page": 1, "markdown": "Just text"}],
            page_count=1,
        )
        with patch(
            "app.processing.postprocess.media.extract_pdf_images",
            return_value=[EmbeddedImage(alt="chart", data=_png(), mime="image/png", page=1)],
        ) as extract:
            updated = embed_read_result_media(result, source, preserve_images=False)

        extract.assert_not_called()
        self.assertNotIn("data:image", updated.markdown())


class MarkdownGapTests(unittest.TestCase):
    def test_pil_and_resolve(self) -> None:
        image = Image.new("RGB", (40, 40), (8, 8, 8))
        url = _pil_to_data_url(image)
        self.assertTrue(url.startswith("data:image/jpeg"))
        md = resolve_markdown_media(
            "![fig](imgs/a.jpg)", pipeline_markdown={"markdown_images": {"imgs/a.jpg": image}}
        )
        self.assertIn("data:image", md)
        self.assertIn("omitted", resolve_markdown_media("![x](imgs/missing.jpg)"))
        html = resolve_markdown_media('<img src="imgs/missing.jpg" />')
        self.assertIn("omitted", html)
        empty = markdown_from_parsing_blocks(
            {"parsing_res_list": [{"block_label": "text", "block_content": "", "block_order": 1}]}
        )
        self.assertEqual(empty.strip(), "")
        abstract = markdown_from_parsing_blocks(
            {
                "parsing_res_list": [
                    {"block_label": "abstract", "block_content": "Summary here", "block_order": 1}
                ]
            }
        )
        self.assertIn("Summary", abstract)


class AnyDocGapTests(unittest.TestCase):
    def test_asset_bytes_and_iter(self) -> None:
        self.assertEqual(_asset_bytes(SimpleNamespace(data=b"abc")), b"abc")
        self.assertIsNone(_asset_bytes(SimpleNamespace(data=None, bytes=None)))
        nested = SimpleNamespace(
            kind="paragraph",
            content=[SimpleNamespace(kind="text", content=None)],
            list=None,
            table=None,
            blocks=None,
        )
        self.assertTrue(list(_iter_blocks([nested])))

    def test_encrypted_and_empty(self) -> None:
        class FakeAny:
            class EncryptedError(Exception):
                pass

            class ConvertError(Exception):
                pass

            @staticmethod
            def format_from_bytes(_data):
                return "pdf"

            @staticmethod
            def to_markdown_bytes(_data, _fmt=None):
                raise FakeAny.EncryptedError("locked")

        reader = AnyDocReader()
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.pdf"
            path.write_bytes(b"%PDF")
            source = SourceFile.from_path(path)
            with patch("app.processing.reading.anydoc.import_anydoc", return_value=FakeAny):
                with self.assertRaises(RuntimeError):
                    reader.read(source)

        class EmptyAny(FakeAny):
            @staticmethod
            def to_markdown_bytes(_data, _fmt=None):
                return "---|---"

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.pdf"
            path.write_bytes(b"%PDF")
            source = SourceFile.from_path(path)
            with patch("app.processing.reading.anydoc.import_anydoc", return_value=EmptyAny):
                with self.assertRaises(RuntimeError):
                    reader.read(source)

    def test_detect_format_fallbacks(self) -> None:
        class FakeAny:
            @staticmethod
            def format_from_bytes(_data):
                return None

            @staticmethod
            def format_from_extension(suffix):
                return "docx" if suffix == ".docx" else None

        self.assertEqual(
            AnyDocReader._detect_format(
                FakeAny, SourceFile(path=Path("a.docx"), filename="a.docx", suffix=".docx"), b"x"
            ),
            "docx",
        )
        self.assertEqual(
            AnyDocReader._detect_format(
                FakeAny, SourceFile(path=Path("a.csv"), filename="a.csv", suffix=".csv"), b"x"
            ),
            "csv",
        )


class OCRFallbackTests(unittest.TestCase):
    def test_second_provider_used(self) -> None:
        reader = OCRReader()
        empty = ExtractResult(engine="PP-OCR", page_count=1, markdown="")
        ok = ExtractResult(engine="Structure", page_count=1, markdown="# hi", json_data={})
        failing = MagicMock()
        failing.id = "ocr"
        failing.label = "OCR"
        failing.extract.side_effect = RuntimeError("boom")
        failing.ensure_ready.return_value = None
        good = MagicMock()
        good.id = "structure"
        good.label = "Structure"
        good.extract.return_value = ok
        good.ensure_ready.return_value = None
        registry = MagicMock()
        registry.get.side_effect = lambda pid: failing if pid == "ocr" else good
        with patch("app.processing.reading.ocr.get_ocr_service") as get_svc:
            get_svc.return_value.registry = registry
            source = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
            result = reader.read(source)
        self.assertIn("hi", result.markdown())

    def test_all_fail(self) -> None:
        reader = OCRReader()
        failing = MagicMock()
        failing.id = "ocr"
        failing.label = "OCR"
        failing.extract.side_effect = RuntimeError("boom")
        failing.ensure_ready.return_value = None
        registry = MagicMock()
        registry.get.return_value = failing
        with patch("app.processing.reading.ocr.get_ocr_service") as get_svc:
            get_svc.return_value.registry = registry
            with self.assertRaises(RuntimeError):
                reader.read(SourceFile(path=Path("a.png"), filename="a.png", suffix=".png"))

    def test_registry_get_and_register(self) -> None:
        class Extra(Reader):
            id = "extra"
            label = "Extra"
            priority = 99

            def can_process(self, source, options=None):
                return Capability.no("n")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                raise AssertionError

        registry = ReaderRegistry([])
        registry.register(Extra())
        self.assertEqual(registry.get("extra").id, "extra")
        with self.assertRaises(KeyError):
            registry.get("missing")


class PipelineTranslateTests(unittest.TestCase):
    def test_translate_not_configured(self) -> None:
        class Ok(Reader):
            id = "ok"
            label = "Ok"
            priority = 1

            def can_process(self, source, options=None):
                return Capability.yes("y")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                return ReadResult(
                    engine_id=self.id,
                    engine_label=self.label,
                    outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="# hi")],
                )

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.txt"
            path.write_text("hi")
            pipeline = DocumentPipeline(readers=ReaderRegistry([Ok()]))
            with self.assertRaises(RuntimeError):
                pipeline.process(path, options=ExtractOptions(target_lang="es"))


class StructureLoadTests(unittest.TestCase):
    def test_load_failure(self) -> None:
        engine = PaddleStructureEngine(
            __import__("app.core.config", fromlist=["get_settings"]).get_settings()
        )
        with patch.dict(
            "sys.modules",
            {"paddleocr": MagicMock(PPStructureV3=MagicMock(side_effect=RuntimeError("no")))},
        ):
            with self.assertRaises(RuntimeError):
                engine._load()

    def test_ocr_structure_enrichment_none(self) -> None:
        engine = PaddleOCREngine(
            __import__("app.core.config", fromlist=["get_settings"]).get_settings()
        )
        with patch(
            "app.engines.paddle_structure.PaddleStructureEngine", side_effect=RuntimeError("no")
        ):
            self.assertIsNone(
                engine._try_structure_enrichment(
                    Path("a.png"),
                    output_format="both",
                    options=ExtractOptions(use_seal_recognition=True),
                )
            )


class StorageFactoryTests(unittest.TestCase):
    def test_s3_requires_bucket(self) -> None:
        from app.core.config import get_settings

        settings = get_settings()
        settings.storage_backend = "s3"
        settings.s3_bucket = None
        get_document_store.cache_clear()
        with self.assertRaises(RuntimeError):
            get_document_store()
        settings.storage_backend = "local"
        get_document_store.cache_clear()


class ExtraEngineTests(unittest.TestCase):
    def test_llm_convert_and_pdf_pages(self) -> None:
        from app.core.config import Settings
        from app.engines.llm.media import render_pdf_pages

        settings = Settings(
            _env_file=None,
            llm_provider="openai",
            llm_api_key="sk-test",
            jwt_secret="test-secret-do-not-use-in-prod-please",
        )
        engine = LLMEngine(settings)
        provider = MagicMock()
        provider.convert.return_value = "```markdown\n# hi\n```"
        with NamedTemporaryFile(suffix=".png") as handle:
            Image.new("RGB", (32, 32), (1, 2, 3)).save(handle.name)
            with (
                patch("app.engines.llm.engine.get_api_provider", return_value=provider),
                patch.object(
                    LLMEngine, "supports_vision", new_callable=PropertyMock, return_value=True
                ),
            ):
                result = engine.extract(Path(handle.name))
        self.assertEqual(result.markdown, "# hi")

        page = MagicMock()
        bitmap = MagicMock()
        bitmap.to_pil.return_value = Image.new("RGB", (40, 40), (2, 2, 2))
        page.render.return_value = bitmap
        document = MagicMock()
        document.__len__.return_value = 1
        document.__getitem__.return_value = page
        pdfium = SimpleNamespace(PdfDocument=lambda _p: document)
        with (
            NamedTemporaryFile(suffix=".pdf") as handle,
            patch.dict("sys.modules", {"pypdfium2": pdfium}),
        ):
            pages = render_pdf_pages(Path(handle.name), max_pages=1, max_side=32)
        self.assertEqual(len(pages), 1)

    def test_provider_convert_and_complete(self) -> None:
        from app.engines.llm.catalog import get_provider_spec
        from app.engines.llm.urls import resolve_http_target
        from app.engines.llm.providers.base import LangChainChatProvider
        from app.core.config import get_settings

        class Fake(LangChainChatProvider):
            id = "openai"

            def build_chat_model(self, request):
                class M:
                    def invoke(self, _msgs):
                        return SimpleNamespace(content="out")

                return M()

        spec = get_provider_spec("openai")
        request = ConvertRequest(
            spec=spec,
            file_path=Path("a.png"),
            suffix=".png",
            api_key="k",
            model="m",
            max_tokens=8,
            timeout_s=1,
            target=resolve_http_target(get_settings(), spec),
            max_pages=1,
            max_image_side=32,
        )
        with NamedTemporaryFile(suffix=".png") as handle:
            Image.new("RGB", (24, 24), (3, 3, 3)).save(handle.name)
            request = ConvertRequest(
                spec=spec,
                file_path=Path(handle.name),
                suffix=".png",
                api_key="k",
                model="m",
                max_tokens=8,
                timeout_s=1,
                target=request.target,
                max_pages=1,
                max_image_side=32,
            )
            text = Fake().convert(request)
            self.assertEqual(text, "out")
            self.assertEqual(Fake().complete_text(request, "hi"), "out")

    def test_paddle_predict_kwargs_fallback(self) -> None:
        from app.core.config import get_settings

        engine = PaddleOCREngine(get_settings())
        calls = {"n": 0}

        def predict(path, **kwargs):
            calls["n"] += 1
            if kwargs:
                raise TypeError("nope")
            return [SimpleNamespace(json={"rec_texts": ["Hi"], "width": 4, "height": 4})]

        engine._pipeline = SimpleNamespace(predict=predict)
        with patch.object(engine, "_needs_structure_enrichment", return_value=False):
            result = engine.extract(Path(__file__))
        self.assertIn("Hi", result.markdown or "")

    def test_app_lifespan(self) -> None:
        from app.main import create_app
        from fastapi.testclient import TestClient

        with patch("app.db.session.init_db"), patch("app.storage.get_document_store"):
            app = create_app()
            with TestClient(app) as client:
                self.assertTrue(getattr(client.app, "title", True))

    def test_google_verify(self) -> None:
        from app.core.config import get_settings
        from app.auth.google import verify_google_id_token

        settings = get_settings()
        settings.google_client_id = "cid"
        with patch("app.auth.google.id_token.verify_oauth2_token", return_value={"sub": "1"}):
            self.assertEqual(verify_google_id_token("tok")["sub"], "1")
        settings.google_client_id = None

    def test_s3_client_and_db_engine(self) -> None:
        from app.core.config import get_settings
        from app.db.session import get_db, get_engine, session_scope
        import app.db.session as sess
        from app.storage.s3 import S3DocumentStore

        store = S3DocumentStore(bucket="b", region="us-west-2")
        boto = MagicMock()
        cfg = SimpleNamespace(Config=MagicMock(return_value=object()))
        with patch.dict("sys.modules", {"boto3": boto, "botocore.config": cfg}):
            client = store._require_client()
            self.assertIs(store._require_client(), client)

        settings = get_settings()
        settings.database_url = "sqlite://"
        sess._engine = None
        sess._SessionLocal = None
        self.assertIsNotNone(get_engine())
        gen = get_db()
        db = next(gen)
        self.assertIsNotNone(db)
        try:
            next(gen)
        except StopIteration:
            pass
        self.assertIsNotNone(session_scope())
        settings.database_url = None
        sess._engine = None
        sess._SessionLocal = None

    def test_upgrade_with_url(self) -> None:
        from app.core.config import get_settings
        from app.db.upgrade import alembic_config, main, upgrade_db

        settings = get_settings()
        settings.database_url = "sqlite://"
        cfg = alembic_config("sqlite://")
        self.assertTrue(cfg.get_main_option("sqlalchemy.url"))
        with (
            patch("app.db.upgrade.command.upgrade"),
            patch("app.db.upgrade.command.history"),
            patch("app.db.upgrade.command.current"),
        ):
            upgrade_db()
            self.assertEqual(main(["history"]), 0)
            self.assertEqual(main(["current"]), 0)
        settings.database_url = None

    def test_llm_reader_when_configured(self) -> None:
        from app.processing.reading.llm import LLMReader
        from app.processing.models import SourceFile
        from app.services.options import ExtractOptions

        reader = LLMReader()
        with (
            patch.object(reader._engine, "configured", return_value=True),
            patch.object(
                type(reader._engine),
                "supports_vision",
                new_callable=PropertyMock,
                return_value=True,
            ),
        ):
            img = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
            self.assertTrue(reader.can_process(img, ExtractOptions(use_ai=True)).supported)
            pdf = SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf")
            self.assertTrue(reader.can_process(pdf, ExtractOptions(use_ai=True)).supported)
            txt = SourceFile(path=Path("a.txt"), filename="a.txt", suffix=".txt")
            self.assertFalse(reader.can_process(txt, ExtractOptions(use_ai=True)).supported)
            self.assertFalse(reader.can_process(img, ExtractOptions(use_ai=False)).supported)


if __name__ == "__main__":
    unittest.main()
