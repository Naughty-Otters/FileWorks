"""OCR routing strategies and chain runners."""

from app.processing.strategy.ocr.assess import assess_source
from app.processing.strategy.ocr.base import OcrRoutingStrategy
from app.processing.strategy.ocr.chains import (
    resolve_deep_ocr_server_url,
    resolve_fast_ocr_server_url,
    resolve_unified_ocr_server_url,
    run_deep_ocr_chain,
    run_fast_ocr_chain,
    run_unified_ocr_for_liteparse,
)
from app.processing.strategy.ocr.liteparse_plan import build_liteparse_attempts, pick_best_parse_result
from app.processing.strategy.ocr.models import OcrAssessment, OcrPlan, OcrRoute
from app.processing.strategy.ocr.quality import markdown_is_weak, ocr_results_are_weak
from app.processing.strategy.ocr.routing import DefaultOcrRoutingStrategy

__all__ = [
    "DefaultOcrRoutingStrategy",
    "OcrAssessment",
    "OcrPlan",
    "OcrRoute",
    "OcrRoutingStrategy",
    "assess_source",
    "build_liteparse_attempts",
    "markdown_is_weak",
    "ocr_results_are_weak",
    "pick_best_parse_result",
    "resolve_deep_ocr_server_url",
    "resolve_fast_ocr_server_url",
    "resolve_unified_ocr_server_url",
    "run_deep_ocr_chain",
    "run_fast_ocr_chain",
    "run_unified_ocr_for_liteparse",
]
