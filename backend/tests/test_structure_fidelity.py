from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.processing.models import Capability, DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.pipeline import DocumentPipeline
from app.processing.postprocess.structure_edit import MarkdownStructureEditor, STRUCTURE_EDIT_PROMPT
from app.processing.reading.anydoc_markdown import document_to_markdown
from app.processing.reading.base import Reader
from app.processing.reading.docling_reader import DoclingReader
from app.processing.reading.ocr import OCRReader
from app.processing.reading.registry import ReaderRegistry
from app.services.markdown import markdown_looks_flat, markdown_structure_score
from app.services.options import ExtractOptions


def _text(value: str, *, bold: bool = False, italic: bool = False) -> SimpleNamespace:
    return SimpleNamespace(
        kind="text",
        text=value,
        style=SimpleNamespace(bold=bold, italic=italic, strike=False, code=False),
        content=None,
        target=None,
        alt=None,
        source=None,
        anchor=None,
        note_id=None,
    )


def _para(*inlines: SimpleNamespace) -> SimpleNamespace:
    return SimpleNamespace(
        kind="paragraph",
        level=None,
        content=list(inlines),
        list=None,
        table=None,
        blocks=None,
        lang=None,
        text=None,
    )


def _heading(level: int, text: str) -> SimpleNamespace:
    return SimpleNamespace(
        kind="heading",
        level=level,
        content=[_text(text)],
        list=None,
        table=None,
        blocks=None,
        lang=None,
        text=None,
        anchor=None,
    )


class AnyDocTreeMarkdownTests(unittest.TestCase):
    def test_heading_list_and_pipe_table(self) -> None:
        table = SimpleNamespace(
            header_rows=1,
            kind="data",
            grid=[
                [
                    SimpleNamespace(kind="origin", cell=SimpleNamespace(blocks=[_para(_text("A"))], col_span=1, row_span=1)),
                    SimpleNamespace(kind="origin", cell=SimpleNamespace(blocks=[_para(_text("B"))], col_span=1, row_span=1)),
                ],
                [
                    SimpleNamespace(kind="origin", cell=SimpleNamespace(blocks=[_para(_text("1"))], col_span=1, row_span=1)),
                    SimpleNamespace(kind="origin", cell=SimpleNamespace(blocks=[_para(_text("2"))], col_span=1, row_span=1)),
                ],
            ],
        )
        lst = SimpleNamespace(
            marker="bullet",
            start=1,
            items=[SimpleNamespace(blocks=[_para(_text("one"))], checked=None, marker_label=None)],
        )
        document = SimpleNamespace(
            blocks=[
                _heading(1, "Title"),
                SimpleNamespace(kind="list", level=None, content=None, list=lst, table=None, blocks=None, lang=None, text=None),
                SimpleNamespace(kind="table", level=None, content=None, list=None, table=table, blocks=None, lang=None, text=None),
            ],
            notes=[],
            assets=[],
        )
        md = document_to_markdown(document)
        self.assertIn("# Title", md)
        self.assertIn("- one", md)
        self.assertIn("| A | B |", md)
        self.assertIn("| 1 | 2 |", md)

    def test_merged_cells_emit_html_table(self) -> None:
        table = SimpleNamespace(
            header_rows=0,
            kind="data",
            grid=[
                [
                    SimpleNamespace(
                        kind="origin",
                        cell=SimpleNamespace(blocks=[_para(_text("wide"))], col_span=2, row_span=1),
                    ),
                    SimpleNamespace(kind="covered", cell=None, origin_row=0, origin_col=0),
                ]
            ],
        )
        document = SimpleNamespace(
            blocks=[
                SimpleNamespace(kind="table", level=None, content=None, list=None, table=table, blocks=None, lang=None, text=None),
            ],
            notes=[],
        )
        md = document_to_markdown(document)
        self.assertIn("<table>", md)
        self.assertIn('colspan="2"', md)
        self.assertIn("wide", md)

    def test_quote_code_rule_notes_and_inlines(self) -> None:
        link = SimpleNamespace(
            kind="link",
            text="",
            style=None,
            content=[_text("here")],
            target=SimpleNamespace(kind="anchor", value="sec"),
            alt=None,
            source=None,
            note_id=None,
        )
        image = SimpleNamespace(
            kind="image",
            text="",
            style=None,
            content=None,
            target=None,
            alt="logo",
            source=SimpleNamespace(kind="external", url="https://x/y.png", asset_id=None),
            note_id=None,
        )
        note_ref = SimpleNamespace(
            kind="note_ref",
            text="",
            style=None,
            content=None,
            target=None,
            alt=None,
            source=None,
            note_id="1",
        )
        quote = SimpleNamespace(
            kind="block_quote",
            level=None,
            content=None,
            list=None,
            table=None,
            blocks=[_para(_text("quoted"))],
            lang=None,
            text=None,
        )
        code = SimpleNamespace(
            kind="code_block",
            level=None,
            content=None,
            list=None,
            table=None,
            blocks=None,
            lang="py",
            text="print(1)",
        )
        rule = SimpleNamespace(
            kind="rule",
            level=None,
            content=None,
            list=None,
            table=None,
            blocks=None,
            lang=None,
            text=None,
        )
        document = SimpleNamespace(
            blocks=[
                _para(_text("bold", bold=True), _text("italic", italic=True), link, image, note_ref),
                quote,
                code,
                rule,
            ],
            notes=[
                SimpleNamespace(id="1", kind="footnote", blocks=[_para(_text("note body"))]),
            ],
        )
        md = document_to_markdown(document)
        self.assertIn("**bold**", md)
        self.assertIn("*italic*", md)
        self.assertIn("[here](#sec)", md)
        self.assertIn("![logo](https://x/y.png)", md)
        self.assertIn("[^1]", md)
        self.assertIn("> quoted", md)
        self.assertIn("```py", md)
        self.assertIn("---", md)
        self.assertIn("[^1]: note body", md)

    def test_none_document_is_empty(self) -> None:
        self.assertEqual(document_to_markdown(None), "")


class QualityGateTests(unittest.TestCase):
    def test_short_text_is_not_flat(self) -> None:
        self.assertFalse(markdown_looks_flat("Just a short note."))
        self.assertEqual(markdown_structure_score("# Hi\n")[0], 1)

    def test_long_prose_without_structure_is_flat(self) -> None:
        wall = "word " * 200
        self.assertTrue(markdown_looks_flat(wall))
        self.assertFalse(markdown_looks_flat("# Heading\n\n" + wall))

    def test_pipeline_skips_flat_when_prefer_structure(self) -> None:
        class Flat(Reader):
            id = "flat"
            label = "Flat"
            priority = 1

            def can_process(self, source, options=None):
                return Capability.yes("y")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                return ReadResult(
                    engine_id=self.id,
                    engine_label=self.label,
                    outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content=("plain " * 200).strip())],
                )

        class Structured(Reader):
            id = "structured"
            label = "Structured"
            priority = 2

            def can_process(self, source, options=None):
                return Capability.yes("y")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                return ReadResult(
                    engine_id=self.id,
                    engine_label=self.label,
                    outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="# Restored\n\nbody")],
                )

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "scan.pdf"
            path.write_bytes(b"%PDF")
            pipeline = DocumentPipeline(readers=ReaderRegistry([Flat(), Structured()]))
            skipped = pipeline.process(path, filename="scan.pdf", options=ExtractOptions())
            self.assertIn("plain", skipped["markdown"])
            restored = pipeline.process(
                path, filename="scan.pdf", options=ExtractOptions(prefer_structure=True)
            )
            self.assertEqual(restored["markdown"], "# Restored\n\nbody")
            self.assertEqual(restored["provider"], "structured")

    def test_pipeline_keeps_last_empty_and_last_flat(self) -> None:
        class Empty(Reader):
            id = "empty"
            label = "Empty"
            priority = 1

            def can_process(self, source, options=None):
                return Capability.yes("y")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                return ReadResult(
                    engine_id=self.id,
                    engine_label=self.label,
                    outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="   ")],
                )

        class FlatThenFail(Reader):
            id = "flat"
            label = "Flat"
            priority = 1

            def can_process(self, source, options=None):
                return Capability.yes("y")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                return ReadResult(
                    engine_id=self.id,
                    engine_label=self.label,
                    outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content=("plain " * 200).strip())],
                )

        class Boom(Reader):
            id = "boom"
            label = "Boom"
            priority = 2

            def can_process(self, source, options=None):
                return Capability.yes("y")

            def read(self, source, *, options=None, preferred_output=OutputKind.MARKDOWN):
                raise RuntimeError("nope")

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "scan.pdf"
            path.write_bytes(b"%PDF")
            empty_only = DocumentPipeline(readers=ReaderRegistry([Empty()]))
            self.assertEqual(empty_only.process(path, filename="scan.pdf")["markdown"].strip(), "")
            fallback = DocumentPipeline(readers=ReaderRegistry([FlatThenFail(), Boom()]))
            out = fallback.process(
                path, filename="scan.pdf", options=ExtractOptions(prefer_structure=True)
            )
            self.assertIn("plain", out["markdown"])
            self.assertEqual(out["provider"], "flat")


class DoclingReaderTests(unittest.TestCase):
    def test_requires_prefer_structure(self) -> None:
        reader = DoclingReader()
        source = SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf")
        self.assertFalse(reader.can_process(source, ExtractOptions()).supported)
        with patch("app.processing.reading.docling_reader.docling_is_available", return_value=True):
            self.assertTrue(reader.can_process(source, ExtractOptions(prefer_structure=True)).supported)
        self.assertFalse(
            reader.can_process(
                SourceFile(path=Path("a.docx"), filename="a.docx", suffix=".docx"),
                ExtractOptions(prefer_structure=True),
            ).supported
        )

    def test_read_mocked_converter(self) -> None:
        reader = DoclingReader()
        fake_doc = MagicMock()
        fake_doc.export_to_markdown.return_value = "# From Docling"
        fake_conv = MagicMock()
        fake_conv.convert.return_value = SimpleNamespace(document=fake_doc)
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.pdf"
            path.write_bytes(b"%PDF")
            source = SourceFile.from_path(path)
            with patch(
                "app.processing.reading.docling_reader._import_converter",
                return_value=lambda **_k: fake_conv,
            ):
                result = reader.read(source, options=ExtractOptions(prefer_structure=True))
        self.assertEqual(result.markdown(), "# From Docling")
        self.assertEqual(result.engine_id, "docling")
        self.assertEqual(result.page_count, 1)

    def test_read_exports_each_docling_page(self) -> None:
        reader = DoclingReader()

        def export_to_markdown(page_no: int | None = None) -> str:
            if page_no is None:
                return "# All"
            return f"# Page {page_no}"

        fake_doc = SimpleNamespace(pages={1: object(), 2: object()}, export_to_markdown=export_to_markdown)
        fake_conv = MagicMock()
        fake_conv.convert.return_value = SimpleNamespace(document=fake_doc)
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "a.pdf"
            path.write_bytes(b"%PDF")
            source = SourceFile.from_path(path)
            with patch(
                "app.processing.reading.docling_reader._import_converter",
                return_value=lambda **_k: fake_conv,
            ), patch(
                "app.processing.reading.docling_reader.pdf_page_count", return_value=2
            ):
                result = reader.read(source, options=ExtractOptions(prefer_structure=True))
        self.assertEqual(result.page_count, 2)
        self.assertEqual(len(result.pages), 2)
        self.assertIn("# Page 1", result.markdown())
        self.assertIn("# Page 2", result.markdown())
        self.assertEqual(result.metadata.get("source_page_count"), 2)


class OCROrderTests(unittest.TestCase):
    def test_structure_first_when_prefer_structure(self) -> None:
        reader = OCRReader()
        structure = MagicMock()
        structure.id = "structure"
        structure.label = "Structure"
        structure.extract.return_value = MagicMock(
            to_dict=lambda: {"markdown": "# layout", "engine": "Structure", "page_count": 1, "pages": []}
        )
        structure.ensure_ready.return_value = None
        ocr = MagicMock()
        ocr.id = "ocr"
        ocr.label = "OCR"
        ocr.ensure_ready.return_value = None
        registry = MagicMock()
        registry.get.side_effect = lambda pid: structure if pid == "structure" else ocr
        with patch("app.processing.reading.ocr.get_ocr_service") as get_svc:
            get_svc.return_value.registry = registry
            source = SourceFile(path=Path("a.png"), filename="a.png", suffix=".png")
            result = reader.read(source, options=ExtractOptions(prefer_structure=True))
        self.assertIn("layout", result.markdown())
        ocr.extract.assert_not_called()
        structure.extract.assert_called()


class StructureEditTests(unittest.TestCase):
    def test_apply_replaces_markdown(self) -> None:
        editor = MarkdownStructureEditor()
        editor._engine = MagicMock()
        editor._engine.configured.return_value = True
        editor._engine.complete_text.return_value = "# Fixed"
        editor._engine.spec = SimpleNamespace(id="openai")
        editor._engine.describe.return_value = {"model": "gpt"}
        result = ReadResult(
            engine_id="anydoc",
            engine_label="AnyDoc",
            outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="wall of text")],
        )
        edited = editor.apply(result)
        self.assertEqual(edited.markdown(), "# Fixed")
        self.assertTrue(edited.metadata.get("structure_edited"))
        prompt = editor._engine.complete_text.call_args[0][0]
        self.assertIn(STRUCTURE_EDIT_PROMPT[:40], prompt)

    def test_skip_when_not_configured(self) -> None:
        editor = MarkdownStructureEditor()
        editor._engine = MagicMock()
        editor._engine.configured.return_value = False
        original = ReadResult(
            engine_id="anydoc",
            engine_label="AnyDoc",
            outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content="# keep")],
        )
        self.assertEqual(editor.apply(original).markdown(), "# keep")
