"""Paddle OCR is off in the convert pipeline until PADDLE_OCR_ENABLED=true."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.core.config import Settings
from app.processing.paddle_gate import liteparse_may_use_paddle, paddle_ocr_is_enabled
from app.processing.pipeline import DocumentPipeline
from app.processing.reading.registry import ReaderRegistry
from app.services.liteparse_ocr_bridge import run_paddle_ocr_for_liteparse
from app.services.ocr_prepare import should_prepare_ocr_input
from app.processing.models import SourceFile


class PaddleGateTests(unittest.TestCase):
    def test_default_settings_disable_in_process_paddle(self) -> None:
        settings = Settings()
        self.assertFalse(settings.paddle_ocr_enabled)
        self.assertFalse(paddle_ocr_is_enabled(settings))
        self.assertFalse(liteparse_may_use_paddle(settings))

    def test_liteparse_paddle_needs_both_flags(self) -> None:
        self.assertFalse(
            liteparse_may_use_paddle(Settings(liteparse_use_paddle_ocr=True, paddle_ocr_enabled=False))
        )
        self.assertFalse(
            liteparse_may_use_paddle(Settings(liteparse_use_paddle_ocr=False, paddle_ocr_enabled=True))
        )
        self.assertTrue(
            liteparse_may_use_paddle(Settings(liteparse_use_paddle_ocr=True, paddle_ocr_enabled=True))
        )

    def test_default_registry_omits_ocr_reader(self) -> None:
        ids = [reader.id for reader in ReaderRegistry(settings=Settings(paddle_ocr_enabled=False)).all()]
        self.assertNotIn("ocr", ids)
        self.assertIn("anydoc", ids)
        self.assertIn("liteparse", ids)

    def test_enabled_registry_includes_ocr_reader(self) -> None:
        ids = [reader.id for reader in ReaderRegistry(settings=Settings(paddle_ocr_enabled=True)).all()]
        self.assertIn("ocr", ids)

    def test_default_pipeline_does_not_try_ocr(self) -> None:
        from PIL import Image

        from app.services.options import ExtractOptions

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "scan.png"
            Image.new("RGB", (32, 32), "white").save(path)
            source = SourceFile.from_path(path, filename="scan.png")
            pipeline = DocumentPipeline(readers=ReaderRegistry(settings=Settings(paddle_ocr_enabled=False)))
            reader_ids = [reader.id for reader in pipeline.readers.all()]
            candidate_ids = [
                reader.id
                for reader, _ in pipeline.decision.decide(
                    source, pipeline.readers.all(), ExtractOptions()
                )
            ]
        self.assertNotIn("ocr", candidate_ids)
        self.assertNotIn("ocr", reader_ids)

    def test_should_not_prepare_input_when_disabled(self) -> None:
        source = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
        self.assertFalse(should_prepare_ocr_input(source, Settings(paddle_ocr_enabled=False)))

    def test_liteparse_bridge_refuses_to_load_paddle(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            run_paddle_ocr_for_liteparse(b"x", settings=Settings(paddle_ocr_enabled=False))
        self.assertIn("PADDLE_OCR_ENABLED", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
