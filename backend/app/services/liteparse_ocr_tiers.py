"""LiteParse parse attempts — driven by OCR routing strategy."""

from __future__ import annotations

from app.processing.strategy.ocr import DefaultOcrRoutingStrategy, pick_best_parse_result

OcrRoutingStrategy = DefaultOcrRoutingStrategy

__all__ = ["DefaultOcrRoutingStrategy", "OcrRoutingStrategy", "pick_best_parse_result"]
