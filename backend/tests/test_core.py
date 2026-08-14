from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory, NamedTemporaryFile

from app.processing.decision.priority import PriorityFallbackDecisionMaker
from app.processing.models import (
    Capability,
    DocumentOutput,
    OutputKind,
    ReadResult,
    SourceFile,
)
from app.processing.reading.base import Reader
from app.services.options import ExtractOptions
from app.services.regions import extract_regions
from app.processing.postprocess.languages import (
    language_catalog,
    language_label,
    normalize_target_lang,
)
from app.engines.utils import collect_texts, json_safe, mime_from_path
from app.engines.base import ExtractResult


class DummyReader(Reader):
    id = "dummy"
    label = "Dummy"
    priority = 20

    def __init__(self, supported: bool, confidence: float = 1.0) -> None:
        self._supported = supported
        self._confidence = confidence

    def can_process(self, source, options=None):
        del source, options
        return Capability.yes("ok", confidence=self._confidence) if self._supported else Capability.no("no")

    def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
        del source, options, preferred_output
        return ReadResult(engine_id=self.id, engine_label=self.label)


class ModelsTests(unittest.TestCase):
    def test_source_from_path_and_image(self) -> None:
        with NamedTemporaryFile(suffix=".png", delete=False) as handle:
            handle.write(b"abc")
            path = Path(handle.name)
        source = SourceFile.from_path(path, mime_type="image/png")
        self.assertTrue(source.is_image)
        self.assertEqual(source.size_bytes, 3)
        pdf = SourceFile(path=Path("x.pdf"), filename="x.pdf", suffix=".pdf")
        self.assertFalse(pdf.is_image)

    def test_capability_helpers(self) -> None:
        self.assertTrue(Capability.yes("x").supported)
        self.assertFalse(Capability.no("nope").supported)

    def test_read_result_markdown_and_api(self) -> None:
        result = ReadResult(
            engine_id="e",
            engine_label="E",
            outputs=[DocumentOutput(kind=OutputKind.TEXT, content="plain")],
            pages=[{"markdown": "plain"}],
            metadata={"a": 1},
        )
        self.assertEqual(result.markdown(), "plain")
        updated = result.with_markdown("new", metadata_extra={"b": 2})
        self.assertEqual(updated.markdown(), "new")
        payload = updated.to_api_dict()
        self.assertEqual(payload["markdown"], "new")
        self.assertIn("json", payload)

    def test_document_output_as_text(self) -> None:
        self.assertEqual(DocumentOutput(kind=OutputKind.JSON, data={"k": 1}).as_text(), "{'k': 1}")
        self.assertEqual(DocumentOutput(kind=OutputKind.TEXT).as_text(), "")

    def test_with_markdown_updates_json_text(self) -> None:
        result = ReadResult(
            engine_id="e",
            engine_label="E",
            outputs=[
                DocumentOutput(kind=OutputKind.MARKDOWN, content="old"),
                DocumentOutput(kind=OutputKind.JSON, data={"text": "old"}),
            ],
        )
        updated = result.with_markdown("fresh")
        json_out = updated.output(OutputKind.JSON)
        self.assertEqual(json_out.data["text"], "fresh")


class DecisionTests(unittest.TestCase):
    def test_orders_by_priority_then_confidence(self) -> None:
        low = DummyReader(True, 0.2)
        low.id = "low"
        low.priority = 10
        high = DummyReader(True, 0.9)
        high.id = "high"
        high.priority = 10
        skip = DummyReader(False)
        maker = PriorityFallbackDecisionMaker()
        source = SourceFile(path=Path("a.txt"), filename="a.txt", suffix=".txt")
        chosen = maker.decide(source, [skip, low, high])
        self.assertEqual([r.id for r, _ in chosen], ["high", "low"])

    def test_prefer_structure_postpones_anydoc_for_pdf_only(self) -> None:
        anydoc = DummyReader(True)
        anydoc.id = "anydoc"
        anydoc.priority = 10
        ocr = DummyReader(True)
        ocr.id = "ocr"
        ocr.priority = 50
        maker = PriorityFallbackDecisionMaker()
        pdf = SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf")
        docx = SourceFile(path=Path("a.docx"), filename="a.docx", suffix=".docx")
        off = [r.id for r, _ in maker.decide(pdf, [anydoc, ocr], ExtractOptions())]
        self.assertEqual(off, ["anydoc", "ocr"])
        on = [
            r.id
            for r, _ in maker.decide(pdf, [anydoc, ocr], ExtractOptions(prefer_structure=True))
        ]
        self.assertEqual(on, ["ocr", "anydoc"])
        office = [
            r.id
            for r, _ in maker.decide(docx, [anydoc, ocr], ExtractOptions(prefer_structure=True))
        ]
        self.assertEqual(office, ["anydoc", "ocr"])


class OptionsTests(unittest.TestCase):
    def test_normalized_lang_and_kwargs(self) -> None:
        opts = ExtractOptions.from_form(target_lang="Original", use_doc_preprocessor=True)
        self.assertEqual(opts.normalized_target_lang(), "")
        self.assertIn("use_table_recognition", opts.to_dict())
        self.assertTrue(opts.structure_predict_kwargs()["use_doc_unwarping"])
        self.assertTrue(opts.paddle_ocr_predict_kwargs()["return_word_box"])
        self.assertEqual(opts.predict_kwargs(), opts.structure_predict_kwargs())
        self.assertIn("use_table_recognition", opts.enabled_keys())


class RegionTests(unittest.TestCase):
    def test_parsing_list(self) -> None:
        payload = {
            "width": 100,
            "height": 80,
            "parsing_res_list": [
                {"block_bbox": [1, 2, 10, 20], "block_label": "text", "block_content": "<b>Hi</b>", "block_order": 1},
                {"block_bbox": [0, 0, 0, 0], "block_label": "skip"},
            ],
        }
        regions, size = extract_regions(payload)
        self.assertEqual(size["width"], 100)
        self.assertEqual(len(regions), 1)
        self.assertEqual(regions[0]["text"], "Hi")

    def test_layout_fallback_and_unwrap(self) -> None:
        payload = {"res": {"layout_det_res": {"boxes": [{"coordinate": [0, 0, 5, 5], "label": "table", "score": 0.9}]}}}
        regions, _ = extract_regions(payload)
        self.assertEqual(regions[0]["label"], "table")
        nested = {"pages": [{"json": {"parsing_res_list": [{"block_bbox": [0, 0, 2, 2], "block_content": "x"}]}}]}
        regions, _ = extract_regions(nested)
        self.assertEqual(regions[0]["text"], "x")

    def test_invalid_payload(self) -> None:
        regions, size = extract_regions("nope")
        self.assertEqual(regions, [])
        self.assertIsNone(size)


class LanguageTests(unittest.TestCase):
    def test_normalize_and_label(self) -> None:
        self.assertEqual(normalize_target_lang("original"), "")
        self.assertEqual(normalize_target_lang("EN"), "en")
        self.assertEqual(language_label("ja"), "Japanese")
        self.assertEqual(language_label("xx"), "xx")
        self.assertGreater(len(language_catalog()), 3)


class EngineUtilsTests(unittest.TestCase):
    def test_json_safe_and_texts(self) -> None:
        class Box:
            def tolist(self):
                return [1, 2]

        self.assertEqual(json_safe({"a": Box()}), {"a": [1, 2]})
        texts = collect_texts({"rec_texts": ["Hello", ""], "nested": {"text": "World"}})
        self.assertEqual(texts, ["Hello", "World"])

    def test_mime_from_path(self) -> None:
        self.assertEqual(mime_from_path("a.PDF"), "application/pdf")
        self.assertEqual(mime_from_path("a.png"), "image/png")
        self.assertEqual(mime_from_path("a.jpg"), "image/jpeg")
        self.assertEqual(mime_from_path("a.tif"), "image/tiff")
        self.assertEqual(mime_from_path("a.webp"), "image/webp")
        self.assertEqual(mime_from_path("a.bmp"), "image/bmp")
        self.assertEqual(mime_from_path("note.txt"), "text/plain")
        self.assertEqual(mime_from_path("readme.MD"), "text/markdown")
        self.assertEqual(mime_from_path("a.bin"), "application/octet-stream")

    def test_extract_result_to_dict(self) -> None:
        result = ExtractResult(engine="e", page_count=1, markdown="m", json_data={"x": 1}, options={"a": True}, provider="p")
        payload = result.to_dict()
        self.assertEqual(payload["markdown"], "m")
        self.assertEqual(payload["provider"], "p")


if __name__ == "__main__":
    unittest.main()
