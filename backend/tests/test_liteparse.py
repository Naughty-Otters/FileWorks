"""LiteParse reader and OCR bridge tests."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.core.config import Settings
from app.processing.models import SourceFile
from app.processing.reading.liteparse import LiteParseReader, liteparse_is_available
from app.services.liteparse_ocr_bridge import (
    _format_paddle_json,
    resolve_liteparse_ocr_server_url,
    run_paddle_ocr_for_liteparse,
)
from app.services.options import ExtractOptions


class LiteParseBridgeTests(unittest.TestCase):
    def test_format_paddle_json(self) -> None:
        payload = {
            "rec_texts": ["Hello", "World"],
            "rec_scores": [0.9, 0.8],
            "rec_boxes": [[0, 0, 10, 10], [20, 0, 40, 10]],
        }
        results = _format_paddle_json(payload)
        self.assertEqual(len(results), 2)
        self.assertEqual(results[0]["text"], "Hello")
        self.assertEqual(results[0]["bbox"], [0.0, 0.0, 10.0, 10.0])

    def test_resolve_internal_ocr_url(self) -> None:
        settings = Settings(liteparse_use_paddle_ocr=True, liteparse_ocr_server_url=None)
        url = resolve_liteparse_ocr_server_url(settings)
        self.assertTrue(url.endswith("/api/ocr"))

    def test_run_paddle_ocr_mocked(self) -> None:
        engine = MagicMock()
        engine.extract.return_value = SimpleNamespace(
            json_data={"rec_texts": ["Hi"], "rec_scores": [0.99], "rec_boxes": [[1, 2, 3, 4]]}
        )
        registry = MagicMock()
        registry.get.return_value = engine
        service = MagicMock(registry=registry)
        with patch("app.services.ocr.get_ocr_service", return_value=service):
            with tempfile.TemporaryDirectory() as tmp:
                settings = Settings(upload_dir=Path(tmp))
                results = run_paddle_ocr_for_liteparse(b"fake", settings=settings)
        self.assertEqual(results[0]["text"], "Hi")


class LiteParseReaderTests(unittest.TestCase):
    def test_can_process_when_disabled(self) -> None:
        reader = LiteParseReader()
        source = SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf")
        with patch("app.processing.reading.liteparse.get_settings") as get_settings:
            get_settings.return_value = Settings(liteparse_enabled=False)
            cap = reader.can_process(source)
        self.assertFalse(cap.supported)

    def test_read_mocked(self) -> None:
        page = SimpleNamespace(
            page_num=1,
            markdown="# Title",
            text="Title",
            text_items=[],
            width=100.0,
            height=200.0,
        )
        parse_result = SimpleNamespace(text="# Title", pages=[page], total_pages=1)
        complexity_page = SimpleNamespace(needs_ocr=False)

        reader = LiteParseReader()
        with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
            path = Path(handle.name)
            source = SourceFile.from_path(path, filename="doc.pdf")

            with patch("app.processing.reading.liteparse.liteparse_is_available", return_value=True):
                with patch("app.processing.reading.liteparse.get_settings") as get_settings:
                    get_settings.return_value = Settings(
                        liteparse_enabled=True,
                        liteparse_route_by_complexity=True,
                        liteparse_use_paddle_ocr=False,
                    )
                    mock_cls = MagicMock()
                    instance = mock_cls.return_value
                    instance.is_complex.return_value = [complexity_page]
                    instance.parse.return_value = parse_result
                    with patch("app.processing.reading.liteparse._import_liteparse", return_value=mock_cls):
                        with patch.object(reader._ocr_strategy, "plan") as plan_mock:
                            from app.processing.strategy.ocr.models import LiteParseAttempt, OcrAssessment, OcrPlan, OcrRoute

                            plan_mock.return_value = OcrPlan(
                                route=OcrRoute.TEXT,
                                assessment=OcrAssessment(needs_ocr=False, pages=[]),
                                liteparse_attempts=(LiteParseAttempt("text", None),),
                            )
                            result = reader.read(source, options=ExtractOptions())

        self.assertEqual(result.engine_id, "liteparse")
        self.assertIn("Title", result.markdown())
        self.assertEqual(result.page_count, 1)

    def test_availability_helper(self) -> None:
        # liteparse is installed in dev with --extra liteparse
        self.assertTrue(liteparse_is_available())


if __name__ == "__main__":
    unittest.main()
