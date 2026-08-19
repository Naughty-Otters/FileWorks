"""OCR routing strategy and reader ordering tests."""

from __future__ import annotations

import io
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from PIL import Image

from app.core.config import Settings
from app.processing.models import SourceFile
from app.processing.reading.base import Reader
from app.processing.strategy.ocr import (
    DefaultOcrRoutingStrategy,
    OcrRoute,
    build_liteparse_attempts,
    markdown_is_weak,
    ocr_results_are_weak,
    pick_best_parse_result,
    resolve_deep_ocr_server_url,
    resolve_fast_ocr_server_url,
    run_deep_ocr_chain,
    run_fast_ocr_chain,
    run_unified_ocr_for_liteparse,
)
from app.processing.strategy.ocr.models import OcrAssessment
from app.processing.strategy.reader.priority import PriorityFallbackReaderOrdering
from app.services.options import ExtractOptions


class OcrStrategyTests(unittest.TestCase):
    def test_fast_route_attempts_include_escalation(self) -> None:
        settings = Settings(
            easyocr_enabled=True,
            paddle_ocr_enabled=True,
            liteparse_use_paddle_ocr=True,
            liteparse_ocr_server_url=None,
        )
        assessment = OcrAssessment(needs_ocr=True, pages=[])
        attempts = build_liteparse_attempts(OcrRoute.FAST, assessment, settings)
        self.assertEqual([item.name for item in attempts], ["tesseract", "fast", "deep"])

    def test_resolve_chain_urls_local_default(self) -> None:
        self.assertTrue(resolve_fast_ocr_server_url().endswith("/api/ocr/fast"))
        self.assertTrue(resolve_deep_ocr_server_url().endswith("/api/ocr/deep"))

    def test_resolve_fast_external_microservice(self) -> None:
        url = resolve_fast_ocr_server_url(
            Settings(ocr_fast_server_url="https://ocr-fast.internal/api/ocr/fast")
        )
        self.assertEqual(url, "https://ocr-fast.internal/api/ocr/fast")

    def test_resolve_deep_external_microservice(self) -> None:
        url = resolve_deep_ocr_server_url(
            Settings(ocr_deep_server_url="https://ocr-deep.internal/api/ocr/deep")
        )
        self.assertEqual(url, "https://ocr-deep.internal/api/ocr/deep")

    def test_resolve_fast_legacy_easyocr_url(self) -> None:
        url = resolve_fast_ocr_server_url(
            Settings(easyocr_ocr_server_url="https://legacy.example/fast")
        )
        self.assertEqual(url, "https://legacy.example/fast")

    def test_plan_text_route_for_pdf_text_layer(self) -> None:
        strategy = DefaultOcrRoutingStrategy()
        with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
            path = Path(handle.name)
            source = SourceFile.from_path(path, filename="text.pdf")
            with patch("app.processing.strategy.ocr.assess.pdf_majority_has_text", return_value=True):
                with patch("app.processing.strategy.ocr.assess._pdf_page_count", return_value=2):
                    plan = strategy.plan(source, ExtractOptions())
        self.assertEqual(plan.route, OcrRoute.TEXT)
        self.assertFalse(plan.assessment.needs_ocr)

    def test_pick_best_prefers_non_weak(self) -> None:
        weak = SimpleNamespace(text="x")
        good = SimpleNamespace(text="This paragraph has enough alphanumeric content to pass.")
        attempts = [("tesseract", None, weak), ("fast", "http://x/fast", good)]
        result, tier, url = pick_best_parse_result(attempts, needs_ocr=True)
        self.assertEqual(tier, "fast")
        self.assertEqual(result, good)


class ReaderOrderingTests(unittest.TestCase):
    def test_llm_before_liteparse_when_use_ai(self) -> None:
        llm = _DummyReader("llm", 30)
        liteparse = _DummyReader("liteparse", 35)
        maker = PriorityFallbackReaderOrdering()
        source = SourceFile(path=Path("scan.png"), filename="scan.png", suffix=".png")
        settings = Settings(llm_provider="openai", llm_api_key="sk-test", llm_model="gpt-4o")
        with patch("app.processing.strategy.reader.llm.llm_vision_ready", return_value=True):
            with patch(
                "app.processing.strategy.reader.priority.get_settings",
                return_value=settings,
            ):
                ordered = [r.id for r, _ in maker.decide(source, [liteparse, llm], ExtractOptions(use_ai=True))]
        self.assertEqual(ordered, ["llm", "liteparse"])

    def test_llm_last_when_use_ai_off(self) -> None:
        llm = _DummyReader("llm", 30)
        liteparse = _DummyReader("liteparse", 35)
        ocr = _DummyReader("ocr", 50)
        maker = PriorityFallbackReaderOrdering()
        source = SourceFile(path=Path("scan.png"), filename="scan.png", suffix=".png")
        settings = Settings(llm_priority_fallback=95)
        with patch(
            "app.processing.strategy.reader.priority.get_settings",
            return_value=settings,
        ):
            ordered = [
                r.id
                for r, _ in maker.decide(source, [llm, liteparse, ocr], ExtractOptions(use_ai=False))
            ]
        self.assertEqual(ordered, ["liteparse", "ocr", "llm"])

    def test_llm_priority_fallback_value_used(self) -> None:
        from app.processing.strategy.reader.priority import _effective_priority

        llm = _DummyReader("llm", 30)
        source = SourceFile(path=Path("scan.png"), filename="scan.png", suffix=".png")
        settings = Settings(llm_priority_fallback=99)
        with patch("app.processing.strategy.reader.llm.llm_vision_ready", return_value=False):
            priority = _effective_priority(llm, source, ExtractOptions(use_ai=False), settings)
        self.assertEqual(priority, 99)


class OcrRoutingPlanTests(unittest.TestCase):
    def test_deep_route_when_prefer_structure(self) -> None:
        strategy = DefaultOcrRoutingStrategy()
        source = SourceFile(path=Path("scan.png"), filename="scan.png", suffix=".png")
        with patch(
            "app.processing.strategy.ocr.routing.assess_source",
            return_value=OcrAssessment(needs_ocr=True, pages=[], source="image"),
        ):
            plan = strategy.plan(source, ExtractOptions(prefer_structure=True))
        self.assertEqual(plan.route, OcrRoute.DEEP)

    def test_assess_image_needs_ocr(self) -> None:
        from app.processing.strategy.ocr.assess import assess_source

        source = SourceFile(path=Path("x.png"), filename="x.png", suffix=".png", mime_type="image/png")
        assessment = assess_source(source, use_liteparse_complexity=False)
        self.assertTrue(assessment.needs_ocr)
        self.assertEqual(assessment.source, "image")

    def test_resolve_unified_local_default(self) -> None:
        from app.processing.strategy.ocr.chains import resolve_unified_ocr_server_url

        self.assertTrue(resolve_unified_ocr_server_url().endswith("/api/ocr"))


class OcrChainTests(unittest.TestCase):
    def test_run_fast_prefers_easyocr(self) -> None:
        easy = [{"text": "Hello from EasyOCR with enough characters"}]
        with patch("app.processing.strategy.ocr.chains.easyocr_is_available", return_value=True):
            with patch("app.processing.strategy.ocr.chains.run_easyocr_for_liteparse", return_value=easy):
                results, backend = run_fast_ocr_chain(
                    b"img",
                    settings=Settings(easyocr_enabled=True, upload_dir=Path("/tmp")),
                )
        self.assertEqual(backend, "easyocr")

    def test_run_deep_falls_back_to_paddle(self) -> None:
        strong = [{"text": "Paddle produced enough readable text for the page"}]
        with patch("app.processing.strategy.ocr.chains.run_paddle_ocr_for_liteparse", return_value=strong):
            results, backend = run_deep_ocr_chain(
                b"img",
                settings=Settings(paddle_ocr_enabled=True, liteparse_use_paddle_ocr=True, upload_dir=Path("/tmp")),
            )
        self.assertEqual(backend, "paddle")
        self.assertEqual(results, strong)

    def test_unified_escalates_to_deep(self) -> None:
        weak = [{"text": "x"}]
        strong = [{"text": "Paddle produced enough readable text for the page"}]
        with patch("app.processing.strategy.ocr.chains.easyocr_is_available", return_value=True):
            with patch("app.processing.strategy.ocr.chains.run_easyocr_for_liteparse", return_value=weak):
                with patch("app.processing.strategy.ocr.chains.run_paddle_ocr_for_liteparse", return_value=strong):
                    results, backend = run_unified_ocr_for_liteparse(
                        b"img",
                        settings=Settings(
                            easyocr_enabled=True,
                            paddle_ocr_enabled=True,
                            liteparse_use_paddle_ocr=True,
                            upload_dir=Path("/tmp"),
                        ),
                    )
        self.assertTrue(backend.startswith("deep:"))
        self.assertEqual(results, strong)

    def test_fast_chain_raises_when_easyocr_disabled(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            run_fast_ocr_chain(
                b"img",
                settings=Settings(easyocr_enabled=False, upload_dir=Path("/tmp")),
            )
        self.assertIn("No OCR backends", str(ctx.exception))

    def test_deep_chain_raises_when_paddle_and_surya_off(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            run_deep_ocr_chain(
                b"img",
                settings=Settings(
                    paddle_ocr_enabled=False,
                    liteparse_use_paddle_ocr=True,
                    surya_enabled=False,
                    upload_dir=Path("/tmp"),
                ),
            )
        self.assertIn("No OCR backends", str(ctx.exception))


class QualityTests(unittest.TestCase):
    def test_markdown_is_weak(self) -> None:
        self.assertTrue(markdown_is_weak("short"))
        self.assertFalse(markdown_is_weak("This paragraph has enough alphanumeric content to pass."))

    def test_ocr_results_are_weak(self) -> None:
        self.assertTrue(ocr_results_are_weak([]))


class _DummyReader(Reader):
    def __init__(self, reader_id: str, priority: int) -> None:
        self.id = reader_id
        self.label = reader_id
        self.priority = priority

    def can_process(self, source, options=None):
        from app.processing.models import Capability

        del source, options
        return Capability.yes("ok")

    def read(self, source, *, options=None, preferred_output=None):
        from app.processing.models import ReadResult

        del source, options, preferred_output
        return ReadResult(engine_id=self.id, engine_label=self.label)


if __name__ == "__main__":
    unittest.main()
