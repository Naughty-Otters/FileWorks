"""Tests for OCR input preparation before Paddle."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from app.core.config import Settings
from app.processing.models import SourceFile
from app.services.ocr_prepare import (
    prepare_ocr_input,
    resolve_ocr_max_input_side,
    should_prepare_ocr_input,
)
from app.services.options import ExtractOptions


def _jpeg(path: Path, size: tuple[int, int]) -> None:
    Image.new("RGB", size, (12, 34, 56)).save(path, format="JPEG")


class OcrPrepareTests(unittest.TestCase):
    def test_resolve_max_side_default_and_high(self) -> None:
        settings = Settings(
            ocr_max_input_side_default=1200,
            ocr_max_input_side_high=2000,
            ocr_platform_max_input_side=2500,
        )
        self.assertEqual(resolve_ocr_max_input_side(ExtractOptions(), settings), 1200)
        self.assertEqual(
            resolve_ocr_max_input_side(ExtractOptions(ocr_high_quality=True), settings),
            2000,
        )

    def test_should_prepare_image_and_skip_text_pdf(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            image = Path(tmp) / "photo.jpg"
            _jpeg(image, (400, 300))
            source = SourceFile.from_path(image)
            self.assertTrue(should_prepare_ocr_input(source))

            docx = Path(tmp) / "doc.docx"
            docx.write_bytes(b"not-a-real-docx")
            office = SourceFile.from_path(docx)
            self.assertFalse(should_prepare_ocr_input(office))

    def test_resize_large_image(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / "scan.jpg"
            _jpeg(image, (3000, 4000))
            source = SourceFile.from_path(image)
            settings = Settings(ocr_max_input_side_default=1754, ocr_platform_max_input_side=None)
            prepared = prepare_ocr_input(
                source, ExtractOptions(), settings=settings, work_dir=root
            )
            with Image.open(prepared.path) as out:
                self.assertLessEqual(max(out.size), 1754)

    def test_skip_small_image(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / "small.jpg"
            _jpeg(image, (800, 600))
            source = SourceFile.from_path(image)
            prepared = prepare_ocr_input(source, ExtractOptions(), work_dir=root)
            self.assertEqual(prepared.path, source.path)

    def test_high_quality_allows_larger_output(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image = root / "scan.jpg"
            _jpeg(image, (3200, 4200))
            source = SourceFile.from_path(image)
            prepared = prepare_ocr_input(
                source,
                ExtractOptions(ocr_high_quality=True),
                settings=Settings(
                    ocr_max_input_side_default=1754,
                    ocr_max_input_side_high=2480,
                    ocr_platform_max_input_side=1200,
                ),
                work_dir=root,
            )
            with Image.open(prepared.path) as out:
                self.assertLessEqual(max(out.size), 1200)

    def test_platform_cap_limits_high_quality(self) -> None:
        settings = Settings(
            ocr_max_input_side_default=1754,
            ocr_max_input_side_high=2480,
            ocr_platform_max_input_side=1200,
        )
        self.assertEqual(resolve_ocr_max_input_side(ExtractOptions(), settings), 1200)
        self.assertEqual(
            resolve_ocr_max_input_side(ExtractOptions(ocr_high_quality=True), settings),
            1200,
        )

    def test_scanned_pdf_is_rasterized(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            images = [Image.new("RGB", (2400, 3200), (i * 30, 40, 50)) for i in range(2)]
            pdf_path = root / "scan.pdf"
            images[0].save(
                pdf_path,
                format="PDF",
                save_all=True,
                append_images=images[1:],
                resolution=300.0,
            )
            source = SourceFile.from_path(pdf_path)
            with patch(
                "app.services.pages.pdf_has_text_layer_majority",
                return_value=False,
            ):
                prepared = prepare_ocr_input(
                    source,
                    ExtractOptions(),
                    settings=Settings(ocr_platform_max_input_side=1200),
                    work_dir=root,
                )
            self.assertNotEqual(prepared.path, source.path)
            import pypdfium2 as pdfium

            doc = pdfium.PdfDocument(str(prepared.path))
            try:
                self.assertEqual(len(doc), 2)
                page = doc[0]
                bitmap = page.render(scale=1.0)
                pil = bitmap.to_pil()
                self.assertLessEqual(max(pil.size), 1200)
            finally:
                doc.close()


if __name__ == "__main__":
    unittest.main()
