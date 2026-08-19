"""LiteParse parse attempt planning."""

from __future__ import annotations

from app.core.config import Settings
from app.processing.strategy.ocr.chains import (
    _first_url,
    resolve_deep_ocr_server_url,
    resolve_fast_ocr_server_url,
)
from app.processing.strategy.ocr.models import LiteParseAttempt, OcrAssessment, OcrRoute
from app.processing.strategy.ocr.quality import markdown_is_weak


def build_liteparse_attempts(
    route: OcrRoute,
    assessment: OcrAssessment,
    settings: Settings,
) -> tuple[LiteParseAttempt, ...]:
    del assessment
    explicit = _first_url(
        settings.ocr_unified_server_url,
        settings.liteparse_ocr_server_url,
    )
    if explicit:
        return (LiteParseAttempt("custom", explicit),)

    from app.processing.pipeline_config import PipelineSpec

    spec = PipelineSpec.from_settings(settings)
    attempts: list[LiteParseAttempt] = [LiteParseAttempt("tesseract", None)]

    if route in {OcrRoute.FAST, OcrRoute.DEEP}:
        if spec.ocr_backend_enabled("easyocr"):
            attempts.append(LiteParseAttempt("fast", resolve_fast_ocr_server_url(settings)))

    from app.processing import paddle_gate

    allow_deep = paddle_gate.liteparse_may_use_paddle(settings) or spec.ocr_backend_enabled("surya")
    if allow_deep and route in {OcrRoute.FAST, OcrRoute.DEEP}:
        attempts.append(LiteParseAttempt("deep", resolve_deep_ocr_server_url(settings)))

    return tuple(attempts)


def pick_best_parse_result(
    attempts: list[tuple[str, str | None, object]],
    *,
    needs_ocr: bool,
) -> tuple[object, str, str | None]:
    if not attempts:
        raise RuntimeError("LiteParse produced no parse attempts")

    if not needs_ocr:
        return attempts[0][2], attempts[0][0], attempts[0][1]

    best: tuple[object, str, str | None] | None = None
    for tier_name, ocr_url, result in attempts:
        md = str(getattr(result, "text", None) or "").strip()
        if not markdown_is_weak(md):
            return result, tier_name, ocr_url
        best = (result, tier_name, ocr_url)

    assert best is not None
    return best
