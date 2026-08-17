"""Default OCR routing — assess pages, pick fast or deep local chains."""

from __future__ import annotations

import logging

from app.core.config import Settings, get_settings
from app.processing.models import SourceFile
from app.processing.strategy.ocr.assess import assess_source
from app.processing.strategy.ocr.base import OcrRoutingStrategy
from app.processing.strategy.ocr.liteparse_plan import build_liteparse_attempts
from app.processing.strategy.ocr.models import LiteParseAttempt, OcrPlan, OcrRoute
from app.services.options import ExtractOptions

logger = logging.getLogger(__name__)


class DefaultOcrRoutingStrategy(OcrRoutingStrategy):
    """
    Local OCR routing (LLM vision is ordered by ``ReaderOrderingStrategy``).

    1. Assess per-page OCR need (text layer / LiteParse complexity)
    2. TEXT — embedded PDF text
    3. FAST — Tesseract → EasyOCR
    4. DEEP — escalate Paddle → Surya (also when prefer_structure / high-quality OCR)
    """

    def plan(
        self,
        source: SourceFile,
        options: ExtractOptions | None = None,
        *,
        settings: Settings | None = None,
    ) -> OcrPlan:
        settings = settings or get_settings()
        opts = options or ExtractOptions()
        assessment = assess_source(
            source,
            use_liteparse_complexity=settings.liteparse_route_by_complexity,
        )

        if assessment.text_layer_majority or not assessment.needs_ocr:
            return OcrPlan(
                route=OcrRoute.TEXT,
                assessment=assessment,
                liteparse_attempts=(LiteParseAttempt("text", None),),
                reason="majority text layer or no OCR pages",
            )

        route = _pick_local_route(opts, settings)
        attempts = build_liteparse_attempts(route, assessment, settings)
        logger.info(
            "OCR strategy for %s: route=%s needs_ocr=%s ocr_pages=%s attempts=%s",
            source.filename,
            route.value,
            assessment.needs_ocr,
            assessment.ocr_page_count,
            [item.name for item in attempts],
        )
        return OcrPlan(
            route=route,
            assessment=assessment,
            liteparse_attempts=attempts,
            reason=f"local {route.value} chain",
        )


def _pick_local_route(options: ExtractOptions, settings: Settings) -> OcrRoute:
    del settings
    if options.prefer_structure or options.ocr_high_quality:
        return OcrRoute.DEEP
    return OcrRoute.FAST
