from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.processing.export.formats import (
    HtmlExporter,
    JsonExporter,
    MarkdownExporter,
    TextExporter,
    markdown_to_html,
    strip_markdown,
)
from app.processing.export.registry import ExportRegistry
from app.processing.models import DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.pipeline import DocumentPipeline
from app.processing.reading.base import Reader
from app.processing.reading.ocr import OCRReader
from app.processing.reading.registry import ReaderRegistry
from app.processing.reading.text import TextReader
from app.processing.models import Capability
from app.services.markdown import (
    markdown_from_parsing_blocks,
    normalize_structure_markdown,
    pick_best_markdown,
    resolve_markdown_media,
)
from app.storage.base import DocumentRecord, utc_now_iso
from app.storage.local import LocalDocumentStore


class ExportTests(unittest.TestCase):
    def test_strip_and_exporters(self) -> None:
        md = "# Title\n\n**bold** and [link](http://x) ![a](x.png)\n"
        self.assertIn("Title", strip_markdown(md))
        html = markdown_to_html("# Hi", title="Doc")
        self.assertIn("<title>Doc</title>", html)
        artifact = MarkdownExporter().export(markdown="# x")
        self.assertTrue(artifact.data.startswith(b"# x"))
        self.assertIn(b"Hello", TextExporter().export(markdown="**Hello**").data)
        self.assertIn(b"<html", HtmlExporter().export(markdown="# H", title="T").data)
        js = JsonExporter().export(markdown="# H", title="T", read_result=ReadResult(engine_id="e", engine_label="E"))
        self.assertIn(b"markdown", js.data)

    def test_registry(self) -> None:
        registry = ExportRegistry()
        self.assertEqual(registry.resolve("md").id, "markdown")
        with self.assertRaises(ValueError):
            registry.resolve("exe")
        self.assertTrue(registry.describe())


class MarkdownServiceTests(unittest.TestCase):
    def test_rebuild_blocks(self) -> None:
        payload = {
            "parsing_res_list": [
                {"block_label": "doc_title", "block_content": "Hello", "block_order": 1},
                {"block_label": "table", "block_content": "a\tb\nx\ty", "block_order": 2},
                {"block_label": "formula", "block_content": "x^2", "block_order": 3},
                {"block_label": "code", "block_content": "print(1)", "block_order": 4},
                {"block_label": "image", "block_content": "chart", "block_order": 5},
                {"block_label": "header", "block_content": "ignore", "block_order": 6},
            ]
        }
        md = markdown_from_parsing_blocks(payload, image_markup=["![c](data:image/jpeg;base64,xx)"])
        self.assertIn("# Hello", md)
        self.assertIn("|", md)
        self.assertIn("$$", md)
        self.assertIn("```", md)
        self.assertIn("![c]", md)

    def test_pick_best_and_resolve(self) -> None:
        primary = "Intro\n\n![crop](imgs/fig.jpg)\n"
        payload = {"parsing_res_list": [{"block_label": "text", "block_content": "Intro", "block_order": 1}]}
        chosen = pick_best_markdown(pipeline_markdown=primary, json_payload=payload)
        self.assertIn("omitted", chosen.lower())
        self.assertEqual(normalize_structure_markdown({"markdown": "a\n\n\n\nb"}), "a\n\nb")
        resolved = resolve_markdown_media("![x](https://example.com/a.png)")
        self.assertIn("https://", resolved)


class StorageTests(unittest.TestCase):
    def test_local_roundtrip(self) -> None:
        with TemporaryDirectory() as tmp:
            store = LocalDocumentStore(Path(tmp))
            rec = store.save_document(
                document_id="abc",
                filename="n.pdf",
                content_type="application/pdf",
                source_bytes=b"%PDF",
                source_suffix="pdf",
                engine="anydoc",
                page_count=1,
                output_format="both",
                markdown="# hi",
                json_data={"t": 1},
                pages=[{"page": 1}],
                owner_id="u1",
            )
            self.assertEqual(rec.filename, "n.pdf")
            self.assertTrue(rec.summary()["has_markdown"])
            loaded = store.get_document("abc")
            self.assertIsNotNone(loaded)
            listed = store.list_documents()
            self.assertEqual(listed[0].id, "abc")
            source = store.get_source_bytes("abc")
            self.assertEqual(source[0], b"%PDF")
            store.save_media_files("abc", [("0.jpg", b"jpeg", "image/jpeg"), ("bad.exe", b"x", "x")])
            self.assertIn("0.jpg", store.load_media_files("abc"))
            self.assertTrue(store.delete_document("abc"))
            self.assertIsNone(store.get_document("abc"))

    def test_record_from_dict(self) -> None:
        rec = DocumentRecord.from_dict(
            {
                "id": "1",
                "filename": "a",
                "content_type": None,
                "size_bytes": 1,
                "source_key": "s",
                "result_key": "r",
                "created_at": utc_now_iso(),
                "json": {"a": 1},
            }
        )
        self.assertEqual(rec.json_data, {"a": 1})
        self.assertIn("json", rec.to_dict())


class PipelineTests(unittest.TestCase):
    def test_fallback_and_export(self) -> None:
        class EmptyReader(Reader):
            id = "empty"
            label = "Empty"
            priority = 1

            def can_process(self, source, options=None):
                return Capability.yes("y")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                return ReadResult(engine_id=self.id, engine_label=self.label)

        class BoomReader(Reader):
            id = "boom"
            label = "Boom"
            priority = 2

            def can_process(self, source, options=None):
                return Capability.yes("y")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                raise RuntimeError("fail")

        class OkReader(Reader):
            id = "ok"
            label = "Ok"
            priority = 3

            def can_process(self, source, options=None):
                return Capability.yes("y")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                return ReadResult(
                    engine_id=self.id,
                    engine_label=self.label,
                    outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="# done")],
                )

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "note.txt"
            path.write_text("hello", encoding="utf-8")
            pipeline = DocumentPipeline(readers=ReaderRegistry([EmptyReader(), BoomReader(), OkReader()]))
            payload = pipeline.process(path, filename="note.txt")
            self.assertEqual(payload["markdown"], "# done")
            artifact = pipeline.export("# x", format_id="txt")
            self.assertEqual(artifact.extension, "txt")
            self.assertTrue(pipeline.list_export_formats())
            self.assertTrue(pipeline.list_readers())

    def test_no_reader(self) -> None:
        class NoneReader(Reader):
            id = "none"
            label = "None"
            priority = 1

            def can_process(self, source, options=None):
                return Capability.no("no")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                raise AssertionError("should not run")

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "x.bin"
            path.write_bytes(b"x")
            pipeline = DocumentPipeline(readers=ReaderRegistry([NoneReader()]))
            with self.assertRaises(RuntimeError):
                pipeline.process(path)


class OCRReaderTests(unittest.TestCase):
    def test_can_process(self) -> None:
        reader = OCRReader()
        img = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
        self.assertTrue(reader.can_process(img).supported)
        pdf = SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf")
        self.assertTrue(reader.can_process(pdf).supported)
        txt = SourceFile(path=Path("a.txt"), filename="a.txt", suffix=".txt")
        self.assertFalse(reader.can_process(txt).supported)

    def test_read_uses_provider(self) -> None:
        reader = OCRReader()
        fake_result = ReadResult(
            engine_id="ocr",
            engine_label="OCR",
            outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="# hi")],
        )
        provider = MagicMock()
        registry = MagicMock()
        registry.get.return_value = provider
        with patch("app.processing.reading.ocr.get_ocr_service") as get_svc, patch(
            "app.processing.reading.ocr.read_with_provider", return_value=fake_result
        ):
            get_svc.return_value.registry = registry
            source = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
            result = reader.read(source)
        self.assertEqual(result.markdown(), "# hi")


class TextReaderTests(unittest.TestCase):
    def test_can_process(self) -> None:
        reader = TextReader()
        self.assertTrue(reader.can_process(SourceFile(path=Path("a.txt"), filename="a.txt", suffix=".txt")).supported)
        self.assertTrue(reader.can_process(SourceFile(path=Path("a.md"), filename="a.md", suffix=".md")).supported)
        self.assertTrue(
            reader.can_process(
                SourceFile(path=Path("a.bin"), filename="a.bin", suffix=".bin", mime_type="text/plain")
            ).supported
        )
        self.assertFalse(reader.can_process(SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf")).supported)

    def test_read_passthrough(self) -> None:
        reader = TextReader()
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "note.md"
            path.write_text("# Hello\n\nworld", encoding="utf-8")
            result = reader.read(SourceFile.from_path(path, filename="note.md"))
            self.assertEqual(result.markdown(), "# Hello\n\nworld")
            self.assertEqual(result.engine_id, "text")

    def test_read_latin1_fallback(self) -> None:
        reader = TextReader()
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "note.txt"
            path.write_bytes("café".encode("latin-1"))
            result = reader.read(SourceFile.from_path(path, filename="note.txt"))
            self.assertIn("caf", result.markdown())

    def test_pipeline_txt_md(self) -> None:
        with TemporaryDirectory() as tmp:
            pipeline = DocumentPipeline(readers=ReaderRegistry([TextReader()]))
            txt = Path(tmp) / "note.txt"
            txt.write_text("plain notes", encoding="utf-8")
            self.assertEqual(pipeline.process(txt, filename="note.txt")["markdown"], "plain notes")
            md = Path(tmp) / "note.md"
            md.write_text("## Title", encoding="utf-8")
            self.assertEqual(pipeline.process(md, filename="note.md")["markdown"], "## Title")


class AnyDocHelperTests(unittest.TestCase):
    def test_empty_markdown(self) -> None:
        from app.processing.reading.anydoc import _markdown_looks_empty, AnyDocReader

        self.assertTrue(_markdown_looks_empty("---|---"))
        self.assertFalse(_markdown_looks_empty("Hello world"))
        reader = AnyDocReader()
        img = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
        self.assertFalse(reader.can_process(img).supported)

    def test_read_with_mocked_anydoc(self) -> None:
        from app.processing.reading import anydoc as anydoc_mod

        class FakeAny:
            class EncryptedError(Exception):
                pass

            class ConvertError(Exception):
                pass

            @staticmethod
            def format_from_bytes(_data):
                return "docx"

            @staticmethod
            def to_markdown_bytes(_data, _fmt=None):
                return "# Doc"

            @staticmethod
            def to_document(_data, _fmt=None):
                return SimpleNamespace(assets=[], blocks=[], notes=[])

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.docx"
            path.write_bytes(b"PK")
            source = SourceFile.from_path(path)
            reader = anydoc_mod.AnyDocReader()
            with patch.object(anydoc_mod, "import_anydoc", return_value=FakeAny), patch.object(
                anydoc_mod, "anydoc_is_available", return_value=True
            ):
                result = reader.read(source)
        self.assertIn("# Doc", result.markdown())


if __name__ == "__main__":
    unittest.main()
