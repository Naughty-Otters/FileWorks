"""Shared PaddleOCR / PP-StructureV3 initialization kwargs from server settings."""

from __future__ import annotations

import inspect
import logging
from typing import Any

from app.core.config import Settings

logger = logging.getLogger(__name__)


def paddle_ocr_init_kwargs(settings: Settings) -> dict[str, Any]:
    return {
        "device": settings.paddle_device,
        "use_doc_orientation_classify": settings.use_doc_orientation_classify,
        "use_doc_unwarping": settings.use_doc_unwarping,
        "use_textline_orientation": settings.use_textline_orientation,
    }


def paddle_structure_init_kwargs(settings: Settings) -> dict[str, Any]:
    """Init kwargs aligned with server defaults — avoid loading heavy modules unless enabled."""
    return {
        "device": settings.paddle_device,
        "use_doc_orientation_classify": settings.use_doc_orientation_classify,
        "use_doc_unwarping": settings.use_doc_unwarping,
        "use_textline_orientation": settings.use_textline_orientation,
        "use_table_recognition": settings.use_table_recognition,
        "use_formula_recognition": settings.use_formula_recognition,
        "use_seal_recognition": settings.use_seal_recognition,
        "use_chart_recognition": settings.use_chart_recognition,
        "use_region_detection": settings.use_region_detection,
        "format_block_content": True,
        "enable_mkldnn": settings.paddle_enable_mkldnn,
    }


def create_pp_structure(settings: Settings) -> Any:
    from paddleocr import PPStructureV3

    kwargs = paddle_structure_init_kwargs(settings)
    logger.info(
        "PP-StructureV3 init: table=%s formula=%s seal=%s chart=%s mkldnn=%s",
        kwargs["use_table_recognition"],
        kwargs["use_formula_recognition"],
        kwargs["use_seal_recognition"],
        kwargs["use_chart_recognition"],
        kwargs["enable_mkldnn"],
    )
    try:
        return PPStructureV3(**kwargs)
    except TypeError:
        kwargs.pop("enable_mkldnn", None)
        try:
            return PPStructureV3(**kwargs)
        except TypeError:
            minimal = {
                "device": settings.paddle_device,
                "use_doc_orientation_classify": settings.use_doc_orientation_classify,
                "use_doc_unwarping": settings.use_doc_unwarping,
                "use_textline_orientation": settings.use_textline_orientation,
            }
            return PPStructureV3(**_filter_kwargs(PPStructureV3, minimal))


def _filter_kwargs(factory: Any, kwargs: dict[str, Any]) -> dict[str, Any]:
    try:
        supported = set(inspect.signature(factory).parameters)
    except (TypeError, ValueError):
        return kwargs
    return {key: value for key, value in kwargs.items() if key in supported}
