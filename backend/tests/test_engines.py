from __future__ import annotations

import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.core.config import get_settings
from app.engines.base import ExtractResult
from app.engines.paddle_ocr import PaddleOCREngine
from app.engines.llm.urls import is_hosted_deepseek, normalize_base_url, resolve_http_target, supports_file_input
from app.engines.llm.catalog import PROVIDERS, get_provider_spec, list_vision_providers, resolve_provider_id
from app.processing.models import SourceFile
from app.processing.reading.provider_adapter import read_with_provider
from app.services.options import ExtractOptions


class PaddleOCREngineTests(unittest.TestCase):
    def test_extract_from_mocked_pipeline(self) -> None:
        settings = get_settings()
        engine = PaddleOCREngine(settings)
        engine._pipeline = SimpleNamespace(
            predict=lambda path, **kwargs: [
                SimpleNamespace(json={"rec_texts": ["Hello"], "width": 10, "height": 8})
            ]
        )
        with patch.object(engine, "_needs_structure_enrichment", return_value=False):
            result = engine.extract(Path(__file__), output_format="both")
        self.assertEqual(engine.id, "ocr")
        self.assertTrue(engine.supports_options())
        self.assertIn("Hello", result.markdown or "")
        self.assertTrue(engine.ready)

    def test_load_failure(self) -> None:
        engine = PaddleOCREngine(get_settings())
        with patch("paddleocr.PaddleOCR", side_effect=RuntimeError("no gpu"), create=True):
            with patch.dict("sys.modules", {"paddleocr": MagicMock(PaddleOCR=MagicMock(side_effect=RuntimeError("boom")))}):
                with self.assertRaises(RuntimeError):
                    engine._load()

    def test_ensure_ready_noop_when_loaded(self) -> None:
        engine = PaddleOCREngine(get_settings())
        engine._pipeline = object()
        engine.ensure_ready()


class LLMUrlTests(unittest.TestCase):
    def test_normalize_and_hosted(self) -> None:
        self.assertEqual(
            normalize_base_url("https://api.deepseek.com/v1/chat/completions"),
            "https://api.deepseek.com/v1",
        )
        self.assertTrue(is_hosted_deepseek("https://api.deepseek.com/v1"))
        spec = get_provider_spec("deepseek")
        self.assertFalse(supports_file_input(spec, "https://api.deepseek.com/v1"))
        self.assertTrue(supports_file_input(spec, "https://custom.example/v1"))
        self.assertTrue(list_vision_providers())

    def test_resolve_http_target(self) -> None:
        settings = get_settings()
        spec = get_provider_spec("openai")
        target = resolve_http_target(settings, spec, endpoint="https://example.com/v1/chat/completions")
        self.assertEqual(target.openai_base_url(), "https://example.com/v1")
        target = resolve_http_target(settings, spec, base_url="https://example.com/v1")
        self.assertIn("example.com", target.base_url)


class ProviderAdapterTests(unittest.TestCase):
    def test_read_with_provider(self) -> None:
        provider = MagicMock()
        provider.id = "ocr"
        provider.extract.return_value = ExtractResult(
            engine="PP-OCR",
            page_count=1,
            markdown="# hi",
            json_data={"a": 1},
            pages=[{"page": 1}],
            regions=[],
            image_size={"width": 1, "height": 1},
        )
        source = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
        result = read_with_provider(
            provider=provider,
            reader_id="ocr",
            reader_label="OCR",
            source=source,
            options=ExtractOptions(),
        )
        self.assertEqual(result.markdown(), "# hi")
        provider.ensure_ready.assert_called()


class CatalogTests(unittest.TestCase):
    def test_known_providers(self) -> None:
        self.assertIn("openai", PROVIDERS)
        self.assertIn("gemini", PROVIDERS)
        self.assertEqual(get_provider_spec("openai").id, "openai")
        self.assertEqual(get_provider_spec("google").id, "gemini")
        self.assertEqual(get_provider_spec("gemini").default_model, "gemini-3.8-flash")
        self.assertEqual(resolve_provider_id("chatgpt"), "openai")
        self.assertEqual(resolve_provider_id("gemini-flash"), "gemini")
        with self.assertRaises(ValueError):
            get_provider_spec("no-such-vendor")


if __name__ == "__main__":
    unittest.main()
