"""Surya OCR bridge for the deep OCR chain (optional)."""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)


def surya_is_available() -> bool:
    try:
        import surya  # noqa: F401

        return True
    except ImportError:
        return False


def run_surya_for_liteparse(
    image_bytes: bytes,
    *,
    language: str = "en",
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """
    Run Surya OCR on one page image.

    Install separately when ``SURYA_ENABLED=true`` (not bundled in default extras).
    """
    del language
    settings = settings or get_settings()
    if not settings.surya_enabled:
        raise RuntimeError("Surya OCR is disabled (SURYA_ENABLED=false)")
    if not surya_is_available():
        raise RuntimeError("Surya OCR is not installed")

    # Placeholder until a pinned surya extra is added — keeps the deep chain slot stable.
    logger.warning("Surya OCR is marked available but no runner is wired yet")
    raise RuntimeError("Surya OCR runner is not implemented yet — install and wire surya extra")
