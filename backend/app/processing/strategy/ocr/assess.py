"""Page-level OCR need assessment."""

from __future__ import annotations

import logging
from pathlib import Path

from app.processing.models import SourceFile
from app.processing.strategy.ocr.models import OcrAssessment, PageOcrAssessment
from app.services.pages import pdf_majority_has_text

logger = logging.getLogger(__name__)


def assess_source(source: SourceFile, *, use_liteparse_complexity: bool = True) -> OcrAssessment:
    if source.suffix == ".pdf":
        try:
            if pdf_majority_has_text(source.path):
                page_count = _pdf_page_count(source.path)
                pages = [
                    PageOcrAssessment(page_number=index, needs_ocr=False, reasons=("text_layer",))
                    for index in range(1, max(page_count, 1) + 1)
                ]
                return OcrAssessment(
                    needs_ocr=False,
                    pages=pages,
                    text_layer_majority=True,
                    source="pdf_text_layer",
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("PDF text-layer probe failed for %s: %s", source.filename, exc)

    if source.is_image:
        return OcrAssessment(
            needs_ocr=True,
            pages=[PageOcrAssessment(page_number=1, needs_ocr=True, reasons=("image",))],
            text_layer_majority=False,
            source="image",
        )

    if use_liteparse_complexity:
        liteparse_pages = _liteparse_complexity(source.path)
        if liteparse_pages is not None:
            needs = any(page.needs_ocr for page in liteparse_pages)
            return OcrAssessment(
                needs_ocr=needs,
                pages=liteparse_pages,
                text_layer_majority=False,
                source="liteparse_complexity",
            )

    return OcrAssessment(needs_ocr=True, pages=[], text_layer_majority=False, source="default")


def _liteparse_complexity(path: Path) -> list[PageOcrAssessment] | None:
    try:
        from liteparse import LiteParse
    except ImportError:
        return None

    probe = LiteParse(quiet=True)
    stats = probe.is_complex(str(path))
    pages: list[PageOcrAssessment] = []
    for item in stats:
        page_no = int(getattr(item, "page_number", 0) or len(pages) + 1)
        reasons = tuple(str(r) for r in (getattr(item, "reasons", None) or []))
        pages.append(
            PageOcrAssessment(
                page_number=page_no,
                needs_ocr=bool(getattr(item, "needs_ocr", False)),
                reasons=reasons,
            )
        )
    return pages


def _pdf_page_count(path: Path) -> int:
    from app.services.pages import pdf_page_count

    return int(pdf_page_count(path) or 0)
