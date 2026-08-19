"""PipelineSpec corners: enable/disable, stage skips, overlay, registry."""

from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

from app.core.config import Settings
from app.processing.models import Capability, DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.pipeline import DocumentPipeline
from app.processing.pipeline_config import PipelineSpec, get_pipeline_spec
from app.processing.reading.anydoc import AnyDocReader
from app.processing.reading.base import Reader
from app.processing.reading.docling_reader import DoclingReader
from app.processing.reading.liteparse_reader import LiteParseReader
from app.processing.reading.llm import LLMReader
from app.processing.reading.ocr import OCRReader
from app.processing.reading.registry import ReaderRegistry
from app.processing.reading.text import TextReader
from app.processing.strategy.reader.priority import PriorityFallbackReaderOrdering
from app.services.options import ExtractOptions

_READER_FLAGS: tuple[tuple[str, str], ...] = (
    ("text", "text_reader_enabled"),
    ("docling", "docling_enabled"),
    ("anydoc", "anydoc_enabled"),
    ("llm", "llm_reader_enabled"),
    ("liteparse", "liteparse_enabled"),
    ("ocr", "paddle_ocr_enabled"),
)

_ALL_READERS_ON = {
    "text_reader_enabled": True,
    "docling_enabled": True,
    "anydoc_enabled": True,
    "llm_reader_enabled": True,
    "liteparse_enabled": True,
    "paddle_ocr_enabled": True,
}


class _OkReader(Reader):
    id = "ok"
    label = "Ok"
    priority = 1

    def can_process(self, source, options=None):
        return Capability.yes("y")

    def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
        del source, options, preferred_output
        return ReadResult(
            engine_id=self.id,
            engine_label=self.label,
            outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="# done")],
            pages=[{"page": 1, "markdown": "# done"}],
            page_count=1,
        )


def _process(pipeline: DocumentPipeline, settings: Settings, **kwargs):
    spec = PipelineSpec.from_settings(settings)
    with TemporaryDirectory() as tmp:
        path = Path(tmp) / "a.txt"
        path.write_text("hello", encoding="utf-8")
        with patch(
            "app.processing.pipeline_config.get_pipeline_spec",
            return_value=spec,
        ), patch("app.core.config.get_settings", return_value=settings):
            return pipeline.process(path, filename="a.txt", **kwargs)


class PipelineSpecLookupTests(unittest.TestCase):
    def test_unknown_stage_fails_open(self) -> None:
        spec = PipelineSpec.from_settings(Settings())
        self.assertTrue(spec.stage_enabled("not-a-stage"))
        self.assertIsNone(spec.item("stages", "not-a-stage"))

    def test_unknown_reader_fails_closed(self) -> None:
        spec = PipelineSpec.from_settings(Settings())
        self.assertFalse(spec.reader_enabled("not-a-reader"))
        self.assertEqual(spec.reader_disabled_reason("not-a-reader"), "Unknown reader 'not-a-reader'")

    def test_unknown_ocr_backend_fails_closed(self) -> None:
        spec = PipelineSpec.from_settings(Settings())
        self.assertFalse(spec.ocr_backend_enabled("not-a-backend"))

    def test_disabled_reason_none_when_enabled(self) -> None:
        spec = PipelineSpec.from_settings(Settings())
        self.assertIsNone(spec.reader_disabled_reason("anydoc"))

    def test_disabled_reason_names_label(self) -> None:
        spec = PipelineSpec.from_settings(Settings(anydoc_enabled=False))
        self.assertEqual(spec.reader_disabled_reason("anydoc"), "AnyDoc is disabled")

    def test_from_settings_none_uses_get_settings(self) -> None:
        settings = Settings(paddle_ocr_enabled=True, surya_enabled=True)
        with patch("app.processing.pipeline_config.get_settings", return_value=settings):
            spec = PipelineSpec.from_settings()
        self.assertTrue(spec.ocr_backend_enabled("paddle"))
        self.assertTrue(spec.ocr_backend_enabled("surya"))

    def test_get_pipeline_spec_passes_settings(self) -> None:
        settings = Settings(easyocr_enabled=False)
        spec = get_pipeline_spec(settings)
        self.assertFalse(spec.ocr_backend_enabled("easyocr"))


class PipelineSpecMappingTests(unittest.TestCase):
    def test_defaults_match_current_deploy_flags(self) -> None:
        spec = PipelineSpec.from_settings(Settings())
        self.assertEqual(
            [item.id for item in spec.stages],
            [
                "prepare_ocr_input",
                "read",
                "media",
                "structure_edit",
                "translate",
                "normalize",
                "fill",
                "project",
                "export",
            ],
        )
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
        self.assertTrue(spec.ocr_backend_enabled("tesseract"))
        self.assertTrue(spec.stage_enabled("media"))
        self.assertTrue(spec.stage_enabled("read"))
        self.assertTrue(spec.stage_enabled("export"))

    def test_read_and_export_stay_on(self) -> None:
        spec = PipelineSpec.from_settings(
            Settings(
                pipeline_media_enabled=False,
                pipeline_translate_enabled=False,
                pipeline_normalize_enabled=False,
            )
        )
        self.assertTrue(spec.stage_enabled("read"))
        self.assertTrue(spec.stage_enabled("export"))
        self.assertFalse(spec.stage_enabled("media"))

    def test_tesseract_stays_on_when_other_ocr_is_off(self) -> None:
        spec = PipelineSpec.from_settings(
            Settings(easyocr_enabled=False, paddle_ocr_enabled=False, surya_enabled=False)
        )
        self.assertTrue(spec.ocr_backend_enabled("tesseract"))
        self.assertFalse(spec.ocr_backend_enabled("easyocr"))
        self.assertFalse(spec.ocr_backend_enabled("paddle"))
        self.assertFalse(spec.ocr_backend_enabled("surya"))

    def test_ocr_reader_tracks_paddle_flag(self) -> None:
        off = PipelineSpec.from_settings(Settings(paddle_ocr_enabled=False))
        on = PipelineSpec.from_settings(Settings(paddle_ocr_enabled=True))
        self.assertFalse(off.reader_enabled("ocr"))
        self.assertFalse(off.ocr_backend_enabled("paddle"))
        self.assertTrue(on.reader_enabled("ocr"))
        self.assertTrue(on.ocr_backend_enabled("paddle"))

    def test_engine_config_knobs_are_copied(self) -> None:
        spec = PipelineSpec.from_settings(
            Settings(
                liteparse_dpi=200,
                liteparse_priority=40,
                liteparse_use_paddle_ocr=False,
                docling_artifacts_path="/models/docling",
                paddle_device="gpu",
                paddle_enable_mkldnn=True,
                paddle_ocr_enabled=True,
                llm_priority=22,
                llm_max_pages=3,
            )
        )
        self.assertEqual(spec.item("readers", "liteparse").config["dpi"], 200)
        self.assertEqual(spec.item("readers", "liteparse").config["priority"], 40)
        self.assertFalse(spec.item("readers", "liteparse").config["use_paddle_ocr"])
        self.assertEqual(spec.item("readers", "docling").config["artifacts_path"], "/models/docling")
        self.assertEqual(spec.item("ocr_backends", "paddle").config["device"], "gpu")
        self.assertTrue(spec.item("ocr_backends", "paddle").config["enable_mkldnn"])
        self.assertEqual(spec.item("readers", "llm").config["priority"], 22)
        self.assertEqual(spec.item("readers", "llm").config["max_pages"], 3)

    def test_stage_flags_toggle_enabled(self) -> None:
        spec = PipelineSpec.from_settings(
            Settings(
                pipeline_prepare_ocr_enabled=False,
                pipeline_media_enabled=False,
                pipeline_structure_edit_enabled=False,
                pipeline_translate_enabled=False,
                pipeline_normalize_enabled=False,
                pipeline_fill_enabled=False,
                pipeline_project_enabled=False,
            )
        )
        for stage_id in (
            "prepare_ocr_input",
            "media",
            "structure_edit",
            "translate",
            "normalize",
            "fill",
            "project",
        ):
            self.assertFalse(spec.stage_enabled(stage_id), stage_id)

    def test_public_dict_has_no_secrets(self) -> None:
        spec = PipelineSpec.from_settings(
            Settings(llm_api_key="secret", translate_api_key="secret")
        )
        blob = str(spec.to_public_dict())
        self.assertNotIn("secret", blob)
        dumped = spec.to_public_dict()
        self.assertEqual(dumped["readers"][0]["kind"], "reader")
        self.assertEqual(dumped["ocr_backends"][0]["kind"], "ocr")
        self.assertEqual(dumped["stages"][0]["kind"], "stage")


class ReaderRegistryGateTests(unittest.TestCase):
    def test_each_flag_omits_only_that_reader(self) -> None:
        for reader_id, flag in _READER_FLAGS:
            kwargs = dict(_ALL_READERS_ON)
            kwargs[flag] = False
            ids = [reader.id for reader in ReaderRegistry(settings=Settings(**kwargs)).all()]
            self.assertNotIn(reader_id, ids, flag)
            for other_id, other_flag in _READER_FLAGS:
                if other_id == reader_id:
                    continue
                self.assertIn(other_id, ids, f"{flag} also dropped {other_id} ({other_flag})")

    def test_explicit_reader_list_bypasses_spec(self) -> None:
        registry = ReaderRegistry(
            [TextReader()],
            settings=Settings(text_reader_enabled=False),
        )
        self.assertEqual([reader.id for reader in registry.all()], ["text"])

    def test_get_missing_reader_raises(self) -> None:
        registry = ReaderRegistry(settings=Settings(paddle_ocr_enabled=False))
        with self.assertRaises(KeyError) as ctx:
            registry.get("ocr")
        self.assertIn("ocr", str(ctx.exception))

    def test_register_can_put_omitted_reader_back(self) -> None:
        registry = ReaderRegistry(settings=Settings(paddle_ocr_enabled=False))
        registry.register(OCRReader())
        self.assertEqual(registry.get("ocr").id, "ocr")


class ReaderCanProcessGateTests(unittest.TestCase):
    def test_text_reader_can_process_respects_disable(self) -> None:
        source = SourceFile(path=Path("a.txt"), filename="a.txt", suffix=".txt")
        with patch(
            "app.processing.reading.text.get_settings",
            return_value=Settings(text_reader_enabled=False),
        ):
            cap = TextReader().can_process(source)
        self.assertFalse(cap.supported)
        self.assertIn("disabled", cap.reason)

    def test_anydoc_can_process_respects_disable(self) -> None:
        source = SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf")
        with patch(
            "app.processing.reading.anydoc.get_settings",
            return_value=Settings(anydoc_enabled=False),
        ):
            cap = AnyDocReader().can_process(source)
        self.assertFalse(cap.supported)
        self.assertIn("disabled", cap.reason)

    def test_docling_stays_off_even_with_prefer_structure(self) -> None:
        source = SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf")
        with patch(
            "app.processing.reading.docling_reader.get_settings",
            return_value=Settings(docling_enabled=False),
        ):
            cap = DoclingReader().can_process(source, ExtractOptions(prefer_structure=True))
        self.assertFalse(cap.supported)
        self.assertIn("disabled", cap.reason)

    def test_liteparse_can_process_respects_disable(self) -> None:
        source = SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf")
        with patch(
            "app.processing.reading.liteparse_reader.get_settings",
            return_value=Settings(liteparse_enabled=False),
        ):
            cap = LiteParseReader().can_process(source)
        self.assertFalse(cap.supported)
        self.assertIn("disabled", cap.reason)

    def test_ocr_stays_off_even_for_images(self) -> None:
        source = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
        with patch(
            "app.processing.reading.ocr.get_settings",
            return_value=Settings(paddle_ocr_enabled=False),
        ):
            cap = OCRReader().can_process(source)
        self.assertFalse(cap.supported)
        self.assertIn("disabled", cap.reason)

    def test_llm_stays_off_even_with_use_ai(self) -> None:
        source = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
        with patch(
            "app.processing.reading.llm.get_settings",
            return_value=Settings(llm_reader_enabled=False),
        ):
            cap = LLMReader().can_process(source, ExtractOptions(use_ai=True))
        self.assertFalse(cap.supported)
        self.assertIn("disabled", cap.reason)


class ExtractOptionsOverlayTests(unittest.TestCase):
    def test_use_ai_cannot_resurrect_disabled_llm(self) -> None:
        settings = Settings(llm_reader_enabled=False, paddle_ocr_enabled=False)
        registry = ReaderRegistry(settings=settings)
        source = SourceFile(path=Path("scan.png"), filename="scan.png", suffix=".png")
        ordered = [
            reader.id
            for reader, _ in PriorityFallbackReaderOrdering().decide(
                source, registry.all(), ExtractOptions(use_ai=True)
            )
        ]
        self.assertNotIn("llm", ordered)
        self.assertNotIn("ocr", ordered)

    def test_prefer_structure_cannot_resurrect_disabled_docling(self) -> None:
        settings = Settings(docling_enabled=False, paddle_ocr_enabled=False)
        registry = ReaderRegistry(settings=settings)
        source = SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf")
        ordered = [
            reader.id
            for reader, _ in PriorityFallbackReaderOrdering().decide(
                source, registry.all(), ExtractOptions(prefer_structure=True)
            )
        ]
        self.assertNotIn("docling", ordered)
        self.assertNotIn("ocr", ordered)


class PipelineStageSkipTests(unittest.TestCase):
    def test_disabled_prepare_ocr_skips_stage(self) -> None:
        pipeline = DocumentPipeline(readers=ReaderRegistry([_OkReader()]))
        pipeline._prepare_ocr_input.prepare = MagicMock(side_effect=lambda source, _opts: source)
        _process(pipeline, Settings(pipeline_prepare_ocr_enabled=False))
        pipeline._prepare_ocr_input.prepare.assert_not_called()

    def test_enabled_prepare_ocr_runs_stage(self) -> None:
        pipeline = DocumentPipeline(readers=ReaderRegistry([_OkReader()]))
        pipeline._prepare_ocr_input.prepare = MagicMock(side_effect=lambda source, _opts: source)
        _process(pipeline, Settings(pipeline_prepare_ocr_enabled=True))
        pipeline._prepare_ocr_input.prepare.assert_called_once()

    def test_disabled_media_stage_skips_embed(self) -> None:
        pipeline = DocumentPipeline(readers=ReaderRegistry([_OkReader()]))
        with patch("app.processing.postprocess.media.embed_read_result_media") as embed:
            payload = _process(pipeline, Settings(pipeline_media_enabled=False))
        embed.assert_not_called()
        self.assertEqual(payload["markdown"], "# done")

    def test_enabled_media_stage_embeds(self) -> None:
        pipeline = DocumentPipeline(readers=ReaderRegistry([_OkReader()]))

        def passthrough(result, source, *, preserve_images=True):
            del source, preserve_images
            return result

        with patch(
            "app.processing.postprocess.media.embed_read_result_media",
            side_effect=passthrough,
        ) as embed:
            _process(pipeline, Settings(pipeline_media_enabled=True))
        embed.assert_called_once()
        self.assertTrue(embed.call_args.kwargs.get("preserve_images", True))

    def test_disabled_structure_edit_skips_even_with_use_ai(self) -> None:
        pipeline = DocumentPipeline(readers=ReaderRegistry([_OkReader()]))
        editor = MagicMock()
        editor.configured.return_value = True
        editor.apply.side_effect = lambda result: result
        with patch(
            "app.processing.postprocess.get_markdown_structure_editor",
            return_value=editor,
        ):
            _process(
                pipeline,
                Settings(pipeline_structure_edit_enabled=False, llm_lambda_function=None),
                options=ExtractOptions(use_ai=True),
            )
        editor.apply.assert_not_called()

    def test_enabled_structure_edit_runs_when_use_ai(self) -> None:
        pipeline = DocumentPipeline(readers=ReaderRegistry([_OkReader()]))
        editor = MagicMock()
        editor.configured.return_value = True
        editor.apply.side_effect = lambda result: result
        with patch(
            "app.processing.postprocess.get_markdown_structure_editor",
            return_value=editor,
        ):
            _process(
                pipeline,
                Settings(pipeline_structure_edit_enabled=True, llm_lambda_function=None),
                options=ExtractOptions(use_ai=True),
            )
        editor.apply.assert_called_once()

    def test_disabled_translate_skips_target_lang(self) -> None:
        pipeline = DocumentPipeline(readers=ReaderRegistry([_OkReader()]))
        with patch("app.processing.postprocess.get_markdown_translator") as translator:
            payload = _process(
                pipeline,
                Settings(pipeline_translate_enabled=False),
                options=ExtractOptions(target_lang="en"),
            )
        translator.assert_not_called()
        self.assertEqual(payload["markdown"], "# done")

    def test_disabled_normalize_omits_structure(self) -> None:
        pipeline = DocumentPipeline(readers=ReaderRegistry([_OkReader()]))
        payload = _process(pipeline, Settings(pipeline_normalize_enabled=False))
        self.assertNotIn("structure", payload)
        self.assertEqual(payload["markdown"], "# done")

    def test_disabled_fill_and_project_leave_engine_markdown(self) -> None:
        pipeline = DocumentPipeline(readers=ReaderRegistry([_OkReader()]))
        for stage in pipeline._structure_stages:
            stage.run = MagicMock(wraps=stage.run)
        payload = _process(
            pipeline,
            Settings(pipeline_fill_enabled=False, pipeline_project_enabled=False),
        )
        by_id = {stage.id: stage.run for stage in pipeline._structure_stages}
        by_id["normalize"].assert_called()
        by_id["fill"].assert_not_called()
        by_id["project"].assert_not_called()
        self.assertEqual(payload["markdown"], "# done")


class PaddleGateViaSpecTests(unittest.TestCase):
    def test_disabling_liteparse_reader_does_not_block_paddle_backend(self) -> None:
        from app.processing.paddle_gate import liteparse_may_use_paddle

        self.assertTrue(
            liteparse_may_use_paddle(
                Settings(
                    liteparse_enabled=False,
                    paddle_ocr_enabled=True,
                    liteparse_use_paddle_ocr=True,
                )
            )
        )


if __name__ == "__main__":
    unittest.main()
