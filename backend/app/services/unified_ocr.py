"""Backward-compatible re-exports — OCR logic lives in ``processing.strategy.ocr``."""

from app.processing.strategy.ocr.chains import (
    resolve_unified_ocr_server_url,
    run_unified_ocr_for_liteparse,
)
from app.processing.strategy.ocr.quality import markdown_is_weak, ocr_results_are_weak

__all__ = [
    "markdown_is_weak",
    "ocr_results_are_weak",
    "resolve_unified_ocr_server_url",
    "run_unified_ocr_for_liteparse",
]
