"""PipelineSpec: stages, readers, and OCR backends each have enable/disable."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import NamedTemporaryFile
from unittest.mock import patch

from app.core.config import Settings
from app.processing.models import SourceFile
from app.processing.pipeline import DocumentPipeline
from app.processing.pipeline_config import PipelineSpec
from app.processing.reading.registry import ReaderRegistry
from app.processing.reading.text import TextReader
from app.services.options import ExtractOptions


class PipelineSpecTests(unittest.TestCase):
    def test_defaults_match_current_deploy_flags(self) -> None:
        spec = PipelineSpec.from_settings(Settings())
        self.assertEqual([item.id for item in spec.stages], [
            "prepare_ocr_input",
            "read",
            "media",
            "structure_edit",
            "translate",
            "normalize",
            "fill",
            "project",
            "export",
        ])
        self.assertEqual(
            [item.id for item in spec.readers],
            ["text", "docling", "anydoc", "llm", "liteparse", "ocr"],
        )
        self.assertEqual(
            [item.id for item in spec.ocr_backends],
            ["tesseract", "easyocr", "paddle", "surya"],
        )
        self.assertTrue(spec.reader_enabled("anydoc"))
        self.assertTrue(spec.reader_enabled("liteparse"))
        self.assertFalse(spec.reader_enabled("ocr"))
        self.assertFalse(spec.ocr_backend_enabled("paddle"))
        self.assertTrue(spec.ocr_backend_enabled("easyocr"))
        self.assertFalse(spec.ocr_backend_enabled("surya"))
        self.assertTrue(spec.stage_enabled("media"))
        self.assertTrue(spec.stage_enabled("read"))

    def test_disable_reader_omits_it_from_registry(self) -> None:
        settings = Settings(anydoc_enabled=False, paddle_ocr_enabled=False)
        ids = [reader.id for reader in ReaderRegistry(settings=settings).all()]
        self.assertNotIn("anydoc", ids)
        self.assertIn("text", ids)

    def test_text_reader_can_process_respects_disable(self) -> None:
        source = SourceFile(path=Path("a.txt"), filename="a.txt", suffix=".txt")
        reader = TextReader()
        with patch(
            "app.processing.reading.text.get_settings",
            return_value=Settings(text_reader_enabled=False),
        ):
            self.assertFalse(reader.can_process(source).supported)

    def test_disabled_media_stage_skips_embed(self) -> None:
        with NamedTemporaryFile(suffix=".txt", delete=False) as handle:
            handle.write(b"hello")
            path = Path(handle.name)
        settings = Settings(pipeline_media_enabled=False, paddle_ocr_enabled=False)
        pipeline = DocumentPipeline(readers=ReaderRegistry(settings=settings))
        with patch(
            "app.processing.pipeline_config.get_pipeline_spec",
            return_value=PipelineSpec.from_settings(settings),
        ):
            with patch("app.processing.postprocess.media.embed_read_result_media") as embed:
                payload = pipeline.process(path, filename="a.txt", options=ExtractOptions())
        embed.assert_not_called()
        self.assertIn("hello", payload.get("markdown") or "")

    def test_public_dict_has_no_secrets(self) -> None:
        spec = PipelineSpec.from_settings(
            Settings(llm_api_key="secret", translate_api_key="secret")
        )
        blob = str(spec.to_public_dict())
        self.assertNotIn("secret", blob)
        self.assertIn("paddle", blob)


if __name__ == "__main__":
    unittest.main()
