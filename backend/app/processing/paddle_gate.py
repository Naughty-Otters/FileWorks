"""Master switch for in-process Paddle (PP-OCR / PP-StructureV3).

Off by default so convert does not load Paddle. Set ``PADDLE_OCR_ENABLED=true``
to put OCRReader and LiteParse's Paddle deep chain back in the pipeline.
"""

from __future__ import annotations

from app.core.config import Settings, get_settings


def paddle_ocr_is_enabled(settings: Settings | None = None) -> bool:
    from app.processing.pipeline_config import PipelineSpec

    spec = PipelineSpec.from_settings(settings or get_settings())
    return spec.ocr_backend_enabled("paddle")


def liteparse_may_use_paddle(settings: Settings | None = None) -> bool:
    from app.processing.pipeline_config import PipelineSpec

    spec = PipelineSpec.from_settings(settings or get_settings())
    liteparse = spec.item("readers", "liteparse")
    use_paddle = True if liteparse is None else bool(liteparse.config.get("use_paddle_ocr"))
    return spec.ocr_backend_enabled("paddle") and use_paddle
