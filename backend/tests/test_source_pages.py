from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, PropertyMock, patch

from app.engines.llm.engine import LLMEngine
from app.services.pages import (
    PAGE_SEPARATOR,
    assemble_page_dicts,
    docling_page_markdowns,
    iter_pdf_page_bytes,
    pdf_majority_has_text,
    pdf_page_count,
    pdf_page_texts,
    pdf_text_layer_stats,
    _normalize_pdf_text,
)


class AssemblePagesTests(unittest.TestCase):
    def test_joins_and_numbers_pages(self) -> None:
        pages, count, joined = assemble_page_dicts(["# A", "# B"], source="anydoc")
        self.assertEqual(count, 2)
        self.assertEqual(len(pages), 2)
        self.assertEqual(pages[0]["page"], 1)
        self.assertEqual(pages[1]["markdown"], "# B")
        self.assertEqual(joined, f"# A{PAGE_SEPARATOR}# B")

    def test_empty_input_still_reports_one_page_slot(self) -> None:
        pages, count, joined = assemble_page_dicts([], source="text")
        self.assertEqual(count, 1)
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0]["markdown"], "")
        self.assertEqual(joined, "")


class DoclingPageMarkdownTests(unittest.TestCase):
    def test_falls_back_when_page_no_unsupported(self) -> None:
        def export_to_markdown(page_no: int | None = None) -> str:
            if page_no is not None:
                raise TypeError("no page_no")
            return "# all"

        document = SimpleNamespace(pages={1: object(), 2: object()}, export_to_markdown=export_to_markdown)
        self.assertEqual(docling_page_markdowns(document), ["# all"])

    def test_exports_each_page(self) -> None:
        document = SimpleNamespace(
            pages={2: object(), 1: object()},
            export_to_markdown=lambda page_no=None: "# all" if page_no is None else f"p{page_no}",
        )
        self.assertEqual(docling_page_markdowns(document), ["p1", "p2"])

    def test_list_pages_use_page_no_attr(self) -> None:
        document = SimpleNamespace(
            pages=[SimpleNamespace(page_no=1), SimpleNamespace(page_number=2), SimpleNamespace()],
            export_to_markdown=lambda page_no=None: "all" if page_no is None else f"p{page_no}",
        )
        self.assertEqual(docling_page_markdowns(document), ["p1", "p2", "p3"])


class PdfPageCountTests(unittest.TestCase):
    def test_invalid_pdf_is_zero(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "bad.pdf"
            path.write_bytes(b"not a pdf")
            self.assertEqual(pdf_page_count(path), 0)

    def test_split_real_two_page_pdf(self) -> None:
        import pypdfium2 as pdfium

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "two.pdf"
            document = pdfium.PdfDocument.new()
            try:
                document.new_page(72, 72)
                document.new_page(72, 72)
                document.save(str(path))
            finally:
                document.close()
            self.assertEqual(pdf_page_count(path), 2)
            payloads = list(iter_pdf_page_bytes(path))
            self.assertEqual([page for page, _data in payloads], [1, 2])
            self.assertTrue(all(data.startswith(b"%PDF") for _page, data in payloads))
            # Blank pages have no text layer — OCR should still run.
            self.assertEqual(pdf_page_texts(path), ["", ""])
            self.assertFalse(pdf_majority_has_text(path))
            texts, with_text, count = pdf_text_layer_stats(path)
            self.assertEqual((texts, with_text, count), (["", ""], 0, 2))

    def test_rasterize_pdf_bytes_returns_jpeg(self) -> None:
        import pypdfium2 as pdfium

        from app.services.pages import rasterize_pdf_bytes

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "one.pdf"
            document = pdfium.PdfDocument.new()
            try:
                document.new_page(72, 72)
                document.save(str(path))
            finally:
                document.close()
            raster = rasterize_pdf_bytes(path.read_bytes())
        self.assertIsNotNone(raster)
        jpeg, mime = raster
        self.assertEqual(mime, "image/jpeg")
        self.assertTrue(jpeg.startswith(b"\xff\xd8"))


class PdfTextLayerTests(unittest.TestCase):
    def test_normalize_collapses_blank_runs(self) -> None:
        self.assertEqual(_normalize_pdf_text("a\n\n\n\nb\n"), "a\n\nb")
        self.assertEqual(_normalize_pdf_text(""), "")

    def test_majority_needs_more_than_half(self) -> None:
        long = "x" * 50
        with patch("app.services.pages.pdf_page_texts", return_value=[long, "", ""]):
            self.assertFalse(pdf_majority_has_text(Path("mixed.pdf")))
        with patch("app.services.pages.pdf_page_texts", return_value=[long, long, ""]):
            self.assertTrue(pdf_majority_has_text(Path("mixed.pdf")))
        with patch("app.services.pages.pdf_page_texts", return_value=[long]):
            self.assertTrue(pdf_majority_has_text(Path("one.pdf")))
        with patch("app.services.pages.pdf_page_texts", return_value=[]):
            self.assertFalse(pdf_majority_has_text(Path("empty.pdf")))


class LLMEnginePageTests(unittest.TestCase):
    def test_uses_convert_pages(self) -> None:
        from app.core.config import Settings
        from PIL import Image

        settings = Settings(
            _env_file=None,
            llm_provider="openai",
            llm_api_key="sk-test",
            jwt_secret="test-secret-do-not-use-in-prod-please",
        )
        engine = LLMEngine(settings)
        provider = MagicMock()
        provider.convert_pages.return_value = ["# p1", "# p2"]
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.png"
            Image.new("RGB", (16, 16), (1, 2, 3)).save(path)
            with patch("app.engines.llm.engine.get_api_provider", return_value=provider), patch.object(
                LLMEngine, "supports_vision", new_callable=PropertyMock, return_value=True
            ):
                result = engine.extract(path)
        self.assertEqual(result.page_count, 2)
        self.assertIn("# p1", result.markdown or "")
        self.assertIn("# p2", result.markdown or "")
        provider.convert.assert_not_called()

    def test_vision_provider_converts_each_raster_page(self) -> None:
        from app.core.config import get_settings
        from app.engines.llm.catalog import get_provider_spec
        from app.engines.llm.providers.base import ConvertRequest, LangChainChatProvider
        from app.engines.llm.urls import resolve_http_target

        class Fake(LangChainChatProvider):
            id = "openai"

            def build_chat_model(self, request):
                return MagicMock()

        spec = get_provider_spec("openai")
        request = ConvertRequest(
            spec=spec,
            file_path=Path("a.pdf"),
            suffix=".pdf",
            api_key="k",
            model="m",
            max_tokens=8,
            timeout_s=1,
            target=resolve_http_target(get_settings(), spec),
            max_pages=8,
            max_image_side=32,
        )
        with patch(
            "app.engines.llm.providers.base.image_blobs",
            return_value=[(b"a", "image/jpeg"), (b"b", "image/jpeg")],
        ), patch("app.engines.llm.providers.base.invoke_markdown", side_effect=["# one", "# two"]):
            pages = Fake().convert_pages(request)
        self.assertEqual(pages, ["# one", "# two"])

