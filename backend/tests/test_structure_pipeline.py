"""Unit tests for structure normalize / fill / project / export."""

from __future__ import annotations

import io
import unittest
import zipfile

from app.processing.export.formats import HtmlExporter, JsonExporter
from app.processing.export.rich import DocxExporter
from app.processing.models import DocumentOutput, OutputKind, ReadResult
from app.processing.structure import (
    fill_structure,
    normalize_read_result,
    project_markdown,
    structure_is_richer,
)
from app.processing.structure.html_table import parse_html_table
from app.processing.structure.render import structure_to_html
from app.processing.structure.schema import StructureDocument


class HtmlTableParseTests(unittest.TestCase):
    def test_rowspan_colspan(self) -> None:
        html = (
            "<table><tr><th rowspan='2' style='background:#ff0'><b>A</b></th>"
            "<td colspan='2'>B</td></tr>"
            "<tr><td>C</td><td>D</td></tr></table>"
        )
        table = parse_html_table(html)
        assert table is not None
        self.assertGreaterEqual(table.rows, 2)
        self.assertGreaterEqual(table.cols, 3)
        origins = {(c.r, c.c): c for c in table.cells}
        self.assertEqual(origins[(0, 0)].text, "A")
        self.assertEqual(origins[(0, 0)].rs, 2)
        self.assertTrue(origins[(0, 0)].is_header)
        self.assertEqual(origins[(0, 0)].style, "background:#ff0")
        self.assertEqual(origins[(0, 0)].html, "<b>A</b>")
        self.assertEqual(origins[(0, 1)].cs, 2)


class NormalizeFillProjectTests(unittest.TestCase):
    def test_paddle_blocks_to_structure(self) -> None:
        page_json = {
            "parsing_res_list": [
                {
                    "block_id": 0,
                    "block_order": 1,
                    "block_label": "doc_title",
                    "block_content": "Invoice",
                    "block_bbox": [10, 10, 100, 40],
                },
                {
                    "block_id": 1,
                    "block_order": 2,
                    "block_label": "table",
                    "block_content": "<table><tr><td>Qty</td><td>Price</td></tr>"
                    "<tr><td>2</td><td>9</td></tr></table>",
                    "block_bbox": [10, 50, 200, 120],
                },
            ]
        }
        result = ReadResult(
            engine_id="ocr",
            engine_label="PP-StructureV3",
            outputs=[
                DocumentOutput(kind=OutputKind.MARKDOWN, content="Invoice"),
                DocumentOutput(kind=OutputKind.JSON, data=page_json),
            ],
            pages=[{"page": 1, "markdown": "Invoice", "json": page_json}],
            page_count=1,
        )
        doc = normalize_read_result(result)
        assert doc is not None
        self.assertEqual(len(doc.blocks), 2)
        filled = fill_structure(doc)
        table_block = next(b for b in filled.blocks if b.label == "table")
        self.assertIsNotNone(table_block.table)
        assert table_block.table is not None
        self.assertGreaterEqual(len(table_block.table.cells), 2)
        md = project_markdown(filled)
        self.assertIn("# Invoice", md)
        self.assertIn("<table", md.lower())

    def test_html_export_uses_structure(self) -> None:
        doc = StructureDocument.model_validate(
            {
                "engine": "test",
                "page_count": 1,
                "blocks": [
                    {"id": "1", "page": 1, "label": "doc_title", "text": "Hello", "order": 1},
                    {
                        "id": "2",
                        "page": 1,
                        "label": "table",
                        "text": "",
                        "order": 2,
                        "table": {
                            "rows": 1,
                            "cols": 2,
                            "cells": [
                                {"r": 0, "c": 0, "text": "A", "rs": 1, "cs": 1},
                                {"r": 0, "c": 1, "text": "B", "rs": 1, "cs": 1},
                            ],
                        },
                    },
                ],
            }
        )
        artifact = HtmlExporter().export(markdown="", title="t", structure=doc)
        html = artifact.data.decode("utf-8")
        self.assertIn("<h1>Hello</h1>", html)
        self.assertIn("<td>A</td>", html)
        json_art = JsonExporter().export(markdown="x", title="t", structure=doc)
        payload = json_art.data.decode("utf-8")
        self.assertIn('"structure"', payload)
        self.assertIn('"Hello"', payload)

    def test_preserves_rich_text_and_layout_groups(self) -> None:
        rich = (
            '<span style="background:#ff0;color:#336699;font-size:18px;'
            'font-family:Arial"><b>Important</b></span>'
        )
        page_json = {
            "width": 1000,
            "height": 1400,
            "parsing_res_list": [
                {
                    "block_id": 1,
                    "block_order": 1,
                    "group_id": 10,
                    "block_label": "text",
                    "block_content": rich,
                    "block_bbox": [50, 100, 450, 300],
                },
                {
                    "block_id": 2,
                    "block_order": 2,
                    "group_id": 20,
                    "block_label": "aside_text",
                    "block_content": "<b>Right column</b>",
                    "block_bbox": [550, 100, 950, 300],
                },
            ],
        }
        result = ReadResult(
            engine_id="ocr",
            engine_label="PP-StructureV3",
            outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content=rich)],
            pages=[{"page": 1, "markdown": rich, "json": page_json}],
            page_count=1,
        )
        doc = normalize_read_result(result)
        assert doc is not None
        self.assertEqual(doc.blocks[0].text, "Important")
        self.assertEqual(doc.blocks[0].rich_text, rich)
        self.assertEqual(doc.blocks[0].group_id, "10")
        self.assertEqual(doc.blocks[0].runs[0].text, "Important")
        self.assertTrue(doc.blocks[0].runs[0].style.bold)
        self.assertEqual(doc.blocks[0].runs[0].style.color, "#336699")
        self.assertEqual(doc.blocks[0].runs[0].style.font_size_pt, 13.5)
        self.assertIn("background:#ff0", project_markdown(doc))
        rendered = structure_to_html(doc)
        self.assertIn('class="fw-layout-page"', rendered)
        self.assertIn("left:55.000%", rendered)
        self.assertIn("<b>Right column</b>", rendered)

        artifact = DocxExporter().export(markdown="", title="t", structure=doc)
        with zipfile.ZipFile(io.BytesIO(artifact.data)) as archive:
            document_xml = archive.read("word/document.xml").decode("utf-8")
        self.assertIn('w:val="336699"', document_xml)
        self.assertIn("<w:b", document_xml)

    def test_plain_layout_parse_does_not_downgrade_engine_markdown(self) -> None:
        """Layout blocks are often plain text; exports must keep the richer markdown."""
        engine_md = "# Report\n\n**Bold intro**\n\n| Qty | Price |\n| --- | --- |\n| 2 | 9 |\n"
        page_json = {
            "width": 1000,
            "height": 1400,
            "parsing_res_list": [
                {
                    "block_id": 0,
                    "block_order": 1,
                    "block_label": "doc_title",
                    "block_content": "Report",
                    "block_bbox": [10, 10, 500, 60],
                },
                {
                    "block_id": 1,
                    "block_order": 2,
                    "block_label": "text",
                    "block_content": "Bold intro",
                    "block_bbox": [10, 80, 500, 120],
                },
                {
                    "block_id": 2,
                    "block_order": 3,
                    "block_label": "table",
                    "block_content": "Qty Price 2 9",
                    "block_bbox": [10, 150, 500, 300],
                },
            ],
        }
        read = ReadResult(
            engine_id="ocr",
            engine_label="PP-StructureV3",
            outputs=[
                DocumentOutput(kind=OutputKind.MARKDOWN, content=engine_md),
                DocumentOutput(kind=OutputKind.JSON, data=page_json),
            ],
            pages=[{"page": 1, "markdown": engine_md, "json": page_json}],
            page_count=1,
        )
        doc = fill_structure(normalize_read_result(read))
        self.assertFalse(structure_is_richer(doc, engine_md))

        html = HtmlExporter().export(markdown=engine_md, title="t", structure=doc).data.decode("utf-8")
        self.assertIn("<table", html)
        self.assertIn("<strong>Bold intro</strong>", html)

        artifact = DocxExporter().export(markdown=engine_md, title="t", structure=doc)
        with zipfile.ZipFile(io.BytesIO(artifact.data)) as archive:
            document_xml = archive.read("word/document.xml").decode("utf-8")
        self.assertIn("<w:tbl>", document_xml)
        self.assertIn("<w:b", document_xml)

    def test_page_markdown_keeps_figures_in_reading_order(self) -> None:
        result = ReadResult(
            engine_id="anydoc",
            engine_label="AnyDoc",
            outputs=[
                DocumentOutput(
                    kind=OutputKind.MARKDOWN,
                    content="Revenue\n\n![chart](data:image/png;base64,abc)\n\nNotes",
                )
            ],
            pages=[
                {
                    "page": 1,
                    "markdown": "Revenue\n\n![chart](data:image/png;base64,abc)\n\nNotes",
                }
            ],
            page_count=1,
        )
        doc = normalize_read_result(result)
        assert doc is not None
        self.assertEqual([block.label for block in doc.blocks], ["text", "image", "text"])
        self.assertEqual(doc.blocks[0].text, "Revenue")
        self.assertIn("data:image/png;base64,abc", doc.blocks[1].image_ref or "")
        self.assertEqual(doc.blocks[2].text, "Notes")
        projected = project_markdown(doc)
        self.assertIn("Revenue", projected)
        self.assertIn("![chart](data:image/png;base64,abc)", projected)
        self.assertIn("Notes", projected)

    def test_project_keeps_engine_markdown_that_already_has_figures(self) -> None:
        from pathlib import Path

        from app.processing.models import SourceFile
        from app.processing.stages.base import PipelineContext
        from app.processing.stages.structure_stages import ProjectStage
        from app.processing.structure.schema import StructureBlock
        from app.services.options import ExtractOptions

        engine_md = ("word " * 80) + "\n\n![chart](data:image/png;base64,abc)\n"
        ctx = PipelineContext(
            source=SourceFile(path=Path("a.pdf"), filename="a.pdf", suffix=".pdf"),
            options=ExtractOptions(prefer_structure=True),
            raw=ReadResult(
                engine_id="anydoc",
                engine_label="AnyDoc",
                outputs=[DocumentOutput(kind=OutputKind.MARKDOWN, content=engine_md)],
            ),
            structure=StructureDocument(
                engine="AnyDoc",
                page_count=1,
                blocks=[
                    StructureBlock(id="1", page=1, label="text", text="flattened caption", order=1),
                ],
            ),
        )
        ProjectStage().run(ctx)
        self.assertIn("data:image/png;base64,abc", ctx.markdown)

    def test_markdown_fallback_keeps_anydoc_inline_styles(self) -> None:
        doc = StructureDocument(
            engine="AnyDoc",
            blocks=[{"id": "md-0", "label": "text", "text": "**bold**"}],
            meta={"native_structure": False},
        )
        artifact = HtmlExporter().export(markdown="**bold**", title="t", structure=doc)
        self.assertIn("<strong>bold</strong>", artifact.data.decode("utf-8"))


if __name__ == "__main__":
    unittest.main()
