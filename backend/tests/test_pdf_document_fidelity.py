"""Fidelity tests for digital PDFs: does every bit of content survive, and does
the page layout stay coherent?

The fixture PDF is built here rather than committed so the suite stays free of
binary assets and of the personal data real policy documents carry. It is a
genuine text-layer PDF (Helvetica / Helvetica-Bold, two columns, a coloured
line, a table grid), so it exercises the same reader path as a real statement.

Set ``FW_SAMPLE_PDF=/path/to/file.pdf`` to additionally run the coverage check
against a real document; that test verifies the pipeline against the PDF's own
text layer, so it needs no committed expectations.
"""

from __future__ import annotations

import os
import re
import unicodedata
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from app.processing.models import OutputKind
from app.processing.pipeline import DocumentPipeline
from app.services.options import ExtractOptions

# --------------------------------------------------------------------------- #
# Fixture: a minimal but valid multi-page PDF with a real text layer.
# --------------------------------------------------------------------------- #

_LETTER = (612, 792)


def _escape(text: str) -> str:
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _content_stream(draws: list[tuple[float, float, str, float, tuple[float, float, float] | None, str]]) -> bytes:
    parts: list[str] = []
    for x, y, font, size, color, text in draws:
        rgb = f"{color[0]} {color[1]} {color[2]} rg\n" if color else "0 0 0 rg\n"
        parts.append(
            f"BT\n{rgb}/{font} {size} Tf\n1 0 0 1 {x} {y} Tm\n({_escape(text)}) Tj\nET\n"
        )
    return "".join(parts).encode("latin-1")


def _build_pdf(pages: list[list[tuple[float, float, str, float, tuple[float, float, float] | None, str]]]) -> bytes:
    """Assemble a PDF 1.4 file with an xref table so any reader can parse it."""
    objects: list[bytes] = []

    def add(body: bytes) -> int:
        objects.append(body)
        return len(objects)  # 1-based object number

    # Reserve 1=Catalog, 2=Pages; fonts and pages follow.
    objects.append(b"")  # placeholder for catalog
    objects.append(b"")  # placeholder for pages
    regular = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    bold = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>")

    kids: list[int] = []
    for draws in pages:
        stream = _content_stream(draws)
        contents = add(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
        page = add(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
            b"/Resources << /Font << /F1 %d 0 R /F2 %d 0 R >> >> /Contents %d 0 R >>"
            % (_LETTER[0], _LETTER[1], regular, bold, contents)
        )
        kids.append(page)

    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (
        b" ".join(b"%d 0 R" % k for k in kids),
        len(kids),
    )

    out = bytearray(b"%PDF-1.4\n")
    offsets: list[int] = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"

    xref_at = len(out)
    out += b"xref\n0 %d\n" % (len(objects) + 1)
    out += b"0000000000 65535 f \n"
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += (
        b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
        % (len(objects) + 1, xref_at)
    )
    return bytes(out)


# Label/value pairs sit in two side-by-side columns. Column interleaving is the
# classic layout failure, so each value must stay next to its own label.
_LEFT_COLUMN = [
    ("Insured Name", "Jana Quintero Publico"),
    ("Street Address", "1284 Marigold Terrace"),
    ("City State Zip", "Springfield Illinois 62704"),
]
_RIGHT_COLUMN = [
    ("Policy Number", "PN 4471 88213"),
    ("Effective Date", "March 01 2026"),
    ("Total Premium", "842.60"),
]
_TABLE_ROWS = [
    ("Bodily Injury Liability", "250000 each person", "318.40"),
    ("Property Damage", "100000 each accident", "204.15"),
    ("Comprehensive", "500 deductible", "162.05"),
    ("Uninsured Motorist", "250000 each person", "158.00"),
]
_PAGE1_MARKER = "POLICY RENEWAL DECLARATION"
_PAGE2_MARKER = "VEHICLE SCHEDULE ADDENDUM"
_RED_LINE = "IMPORTANT ACTION REQUIRED BEFORE RENEWAL"
_VEHICLES = [
    ("2019 Sedan Model X", "VIN 1HGCM82633A004352"),
    ("2022 Wagon Model Y", "VIN 5YJSA1E26MF102938"),
]


def _fixture_pdf() -> bytes:
    page1: list[tuple[float, float, str, float, tuple[float, float, float] | None, str]] = [
        (60, 740, "F2", 17, None, _PAGE1_MARKER),
        (60, 712, "F2", 11, (0.85, 0.1, 0.1), _RED_LINE),
    ]
    y = 670
    for (llabel, lvalue), (rlabel, rvalue) in zip(_LEFT_COLUMN, _RIGHT_COLUMN):
        page1.append((60, y, "F2", 10, None, llabel))
        page1.append((60, y - 14, "F1", 10, None, lvalue))
        page1.append((330, y, "F2", 10, None, rlabel))
        page1.append((330, y - 14, "F1", 10, None, rvalue))
        y -= 40

    y = 520
    page1.append((60, y, "F2", 10, None, "Coverage"))
    page1.append((300, y, "F2", 10, None, "Limit"))
    page1.append((490, y, "F2", 10, None, "Premium"))
    for coverage, limit, premium in _TABLE_ROWS:
        y -= 22
        page1.append((60, y, "F1", 10, None, coverage))
        page1.append((300, y, "F1", 10, None, limit))
        page1.append((490, y, "F1", 10, None, premium))

    page2: list[tuple[float, float, str, float, tuple[float, float, float] | None, str]] = [
        (60, 740, "F2", 15, None, _PAGE2_MARKER),
    ]
    y = 690
    for description, vin in _VEHICLES:
        page2.append((60, y, "F2", 10, None, description))
        page2.append((300, y, "F1", 10, None, vin))
        y -= 30

    return _build_pdf([page1, page2])


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _normalize(value: str) -> str:
    """Collapse to comparable characters so wrapping/spacing cannot cause noise."""
    return re.sub(r"[^0-9a-z]+", "", unicodedata.normalize("NFKC", value).lower())


def _strip_embedded_images(markdown: str) -> str:
    return re.sub(r"!\[[^\]]*\]\(data:[^)]*\)", " ", markdown)


def _table_rows(markdown: str) -> list[list[str]]:
    """Split markdown pipe tables into rows of cells, dropping separator rows."""
    rows: list[list[str]] = []
    for line in markdown.splitlines():
        stripped = line.strip()
        if not (stripped.startswith("|") and stripped.endswith("|") and len(stripped) > 1):
            continue
        cells = [cell.strip() for cell in stripped[1:-1].split("|")]
        if any(cell and set(cell) <= set("-: ") for cell in cells):
            continue
        rows.append(cells)
    return rows


def _find_cell(rows: list[list[str]], needle: str) -> tuple[int, int] | None:
    """Locate ``needle`` as (row, column) so column drift becomes detectable."""
    target = _normalize(needle)
    if not target:
        return None
    for row_index, cells in enumerate(rows):
        for column_index, cell in enumerate(cells):
            if target in _normalize(cell):
                return row_index, column_index
    return None


def _column_in_row(row: list[str], needle: str) -> int | None:
    target = _normalize(needle)
    for index, cell in enumerate(row):
        if target and target in _normalize(cell):
            return index
    return None


def _extract(path: Path, **kwargs) -> dict:
    return DocumentPipeline().process(
        path,
        filename=path.name,
        options=ExtractOptions(**kwargs),
        preferred_output=OutputKind.MARKDOWN,
        api_output_format="both",
    )


class PdfFidelityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = TemporaryDirectory()
        cls.pdf_path = Path(cls._tmp.name) / "renewal-fixture.pdf"
        cls.pdf_path.write_bytes(_fixture_pdf())
        cls.result = _extract(cls.pdf_path)
        cls.markdown = _strip_embedded_images(cls.result.get("markdown") or "")
        cls.flat = _normalize(cls.markdown)

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def test_fixture_pdf_has_a_readable_text_layer(self) -> None:
        """Guard the fixture itself, so a failure below points at the pipeline."""
        pdfium = __import__("pypdfium2")
        document = pdfium.PdfDocument(str(self.pdf_path))
        self.assertEqual(len(document), 2)
        seeded = _normalize("".join(page.get_textpage().get_text_range() for page in document))
        for label, value in (*_LEFT_COLUMN, *_RIGHT_COLUMN):
            self.assertIn(_normalize(label), seeded)
            self.assertIn(_normalize(value), seeded)

    def test_every_field_and_table_cell_survives(self) -> None:
        for label, value in (*_LEFT_COLUMN, *_RIGHT_COLUMN):
            self.assertIn(_normalize(label), self.flat, f"lost label {label!r}")
            self.assertIn(_normalize(value), self.flat, f"lost value {value!r}")
        for row in _TABLE_ROWS:
            for cell in row:
                self.assertIn(_normalize(cell), self.flat, f"lost table cell {cell!r}")
        for description, vin in _VEHICLES:
            self.assertIn(_normalize(description), self.flat, f"lost vehicle {description!r}")
            self.assertIn(_normalize(vin), self.flat, f"lost VIN {vin!r}")
        self.assertIn(_normalize(_RED_LINE), self.flat)

    def test_side_by_side_fields_keep_their_own_column(self) -> None:
        """Each value must sit under its own label, not the neighbouring column's.

        The two columns are reconstructed as a table, so a value landing in a
        different column than its label is exactly the interleaving failure.
        """
        rows = _table_rows(self.markdown)
        self.assertTrue(rows, "side-by-side fields were not captured as a table")
        for label, value in (*_LEFT_COLUMN, *_RIGHT_COLUMN):
            at_label = _find_cell(rows, label)
            at_value = _find_cell(rows, value)
            self.assertIsNotNone(at_label, f"label {label!r} is not in any table cell")
            self.assertIsNotNone(at_value, f"value {value!r} is not in any table cell")
            assert at_label is not None and at_value is not None
            self.assertEqual(
                at_value[1],
                at_label[1],
                f"{value!r} is in column {at_value[1]} but its label {label!r} is in column {at_label[1]}",
            )
            self.assertGreater(
                at_value[0],
                at_label[0],
                f"{value!r} appears above its label {label!r}",
            )

    def test_table_rows_keep_cells_in_their_columns(self) -> None:
        rows = _table_rows(self.markdown)
        header = _find_cell(rows, "Coverage")
        self.assertIsNotNone(header, "coverage table header was lost")
        assert header is not None
        header_row, coverage_column = header
        limit_column = _column_in_row(rows[header_row], "Limit")
        premium_column = _column_in_row(rows[header_row], "Premium")
        self.assertIsNotNone(limit_column, "Limit column header was lost")
        self.assertIsNotNone(premium_column, "Premium column header was lost")

        for coverage, limit, premium in _TABLE_ROWS:
            found = _find_cell(rows, coverage)
            self.assertIsNotNone(found, f"row {coverage!r} was lost")
            assert found is not None
            row_index, column_index = found
            self.assertGreater(row_index, header_row, f"row {coverage!r} sits above the header")
            self.assertEqual(column_index, coverage_column, f"row {coverage!r} changed column")
            cells = rows[row_index]
            for column, expected in ((limit_column, limit), (premium_column, premium)):
                assert column is not None
                self.assertLess(column, len(cells), f"row {coverage!r} is missing column {column}")
                self.assertEqual(
                    _normalize(cells[column]),
                    _normalize(expected),
                    f"row {coverage!r} column {column} holds {cells[column]!r}, expected {expected!r}",
                )

    def test_pages_stay_in_reading_order(self) -> None:
        self.assertEqual(self.result.get("page_count"), 2)
        self.assertEqual(len(self.result.get("pages") or []), 2)
        first = self.flat.find(_normalize(_PAGE1_MARKER))
        second = self.flat.find(_normalize(_PAGE2_MARKER))
        self.assertGreaterEqual(first, 0)
        self.assertGreaterEqual(second, 0)
        self.assertLess(first, second, "page 2 content was emitted before page 1")

    def test_flat_structure_keeps_export_on_the_markdown_path(self) -> None:
        """A reader that yields no layout must not let exports rebuild from the IR.

        Blocks without bbox/table carry only plain text, so exporting from the
        structure IR would drop the markdown's tables and emphasis.
        """
        from app.processing.export.formats import HtmlExporter
        from app.processing.structure.richness import structure_is_richer
        from app.processing.structure.schema import StructureDocument

        structure = self.result.get("structure")
        self.assertIsInstance(structure, dict)
        document = StructureDocument.model_validate(structure)
        self.assertFalse(structure_is_richer(document, self.result.get("markdown") or ""))

        markdown = "# T\n\n**bold**\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n"
        html = HtmlExporter().export(markdown=markdown, title="t", structure=document).data.decode("utf-8")
        self.assertIn("<table", html)
        self.assertIn("<strong>bold</strong>", html)


class PreferStructureRoutingTests(unittest.TestCase):
    """`prefer_structure` must not route a text-layer PDF to the flattest reader.

    The OCR reader returns a native text layer verbatim, with no headings or
    tables, so demoting the structured reader for such PDFs made the toggle
    produce worse structure than leaving it off.
    """

    def _order(self, path: Path, **kwargs) -> list[str]:
        from app.processing.decision import PriorityFallbackDecisionMaker
        from app.processing.models import SourceFile
        from unittest.mock import patch

        source = SourceFile(
            path=path,
            filename=path.name,
            mime_type="application/pdf",
            suffix=".pdf",
        )
        with patch("app.processing.paddle_gate.paddle_ocr_is_enabled", return_value=True):
            candidates = PriorityFallbackDecisionMaker().decide(
                source, DocumentPipeline().readers.all(), ExtractOptions(**kwargs)
            )
        return [reader.id for reader, _ in candidates]

    def test_text_layer_pdf_keeps_the_structured_reader_first(self) -> None:
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "digital.pdf"
            path.write_bytes(_fixture_pdf())
            order = self._order(path)
            structured_order = self._order(path, prefer_structure=True)
            self.assertLess(order.index("anydoc"), order.index("ocr"))
            self.assertLess(structured_order.index("anydoc"), structured_order.index("ocr"))

            plain = _extract(path)
            structured = _extract(path, prefer_structure=True)

        from app.services.markdown import markdown_structure_score

        plain_score = markdown_structure_score(plain.get("markdown") or "")
        structured_score = markdown_structure_score(structured.get("markdown") or "")
        self.assertGreater(structured_score[0], 0, "prefer_structure lost every heading")
        self.assertGreater(structured_score[2], 0, "prefer_structure lost every table")
        self.assertGreaterEqual(
            (structured_score[0], structured_score[2]),
            (plain_score[0], plain_score[2]),
            "prefer_structure produced less structure than leaving it off",
        )

    def test_scanned_pdf_still_prefers_recognition(self) -> None:
        from PIL import Image, ImageDraw

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "scanned.pdf"
            pages = []
            for number in (1, 2):
                canvas = Image.new("RGB", (850, 1100), "white")
                ImageDraw.Draw(canvas).text((60, 60), f"SCANNED PAGE {number}", fill="black")
                pages.append(canvas)
            pages[0].save(path, save_all=True, append_images=pages[1:])

            default = self._order(path)
            structured = self._order(path, prefer_structure=True)
            self.assertLess(default.index("anydoc"), default.index("ocr"))
            self.assertLess(structured.index("ocr"), structured.index("anydoc"))


class FlatMarkdownDetectionTests(unittest.TestCase):
    def test_raw_text_dump_with_stray_list_lines_is_flat(self) -> None:
        """Lines that merely open like list items must not pass as structure."""
        from app.services.markdown import markdown_looks_flat

        body = "\n".join(f"Policy detail line number {n} for the renewal notice" for n in range(120))
        strays = "\n".join(f"{n}) reference code 25-597{n}" for n in range(6))
        self.assertTrue(markdown_looks_flat(f"{body}\n{strays}"))

    def test_genuinely_bulleted_document_is_not_flat(self) -> None:
        from app.services.markdown import markdown_looks_flat

        bulleted = "\n".join(f"- coverage item {n} included in this policy term" for n in range(40))
        self.assertFalse(markdown_looks_flat(bulleted))

    def test_headings_or_tables_always_count_as_structure(self) -> None:
        from app.services.markdown import markdown_looks_flat

        filler = "Renewal narrative text that is long enough to be considered. " * 12
        self.assertFalse(markdown_looks_flat(f"# Title\n\n{filler}"))
        self.assertFalse(markdown_looks_flat(f"| A | B |\n| --- | --- |\n| 1 | 2 |\n\n{filler}"))


@unittest.skipUnless(os.environ.get("FW_SAMPLE_PDF"), "set FW_SAMPLE_PDF to check a real document")
class RealPdfCoverageTests(unittest.TestCase):
    """Coverage check against a real PDF, verified against its own text layer.

    Nothing about the document is committed, so this works with any statement.
    """

    MIN_CHAR_COVERAGE = 0.98
    MIN_LINE_COVERAGE = 0.95

    def test_text_layer_is_fully_represented(self) -> None:
        pdfium = __import__("pypdfium2")
        path = Path(os.environ["FW_SAMPLE_PDF"]).expanduser()
        self.assertTrue(path.is_file(), f"{path} not found")

        document = pdfium.PdfDocument(str(path))
        truth = [page.get_textpage().get_text_range() for page in document]

        result = _extract(path)
        haystack = _normalize(_strip_embedded_images(result.get("markdown") or ""))

        self.assertEqual(result.get("page_count"), len(document), "page count drifted from the PDF")

        expected_chars = sum(len(_normalize(page)) for page in truth)
        self.assertGreaterEqual(
            len(haystack) / max(1, expected_chars),
            self.MIN_CHAR_COVERAGE,
            "extracted text is materially shorter than the PDF text layer",
        )

        # "Fold here" / "cut here" marks are rotated furniture that readers may
        # legitimately drop, so require a high share of lines rather than all.
        lines = [line for page in truth for line in page.splitlines() if len(_normalize(line)) >= 8]
        present = sum(1 for line in lines if _normalize(line) in haystack)
        coverage = present / max(1, len(lines))
        self.assertGreaterEqual(
            coverage,
            self.MIN_LINE_COVERAGE,
            f"only {coverage:.1%} of text-layer lines survived extraction",
        )


if __name__ == "__main__":
    unittest.main()
