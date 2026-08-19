"""OCR backend chains — fast (EasyOCR) and deep (Paddle → Surya)."""

from __future__ import annotations

import logging
import os
from typing import Any, Callable

from app.core.config import Settings, get_settings
from app.processing.pipeline_config import PipelineSpec
from app.processing.strategy.ocr.quality import ocr_results_are_weak
from app.services.easyocr_bridge import easyocr_is_available, run_easyocr_for_liteparse
from app.services.liteparse_ocr_bridge import run_paddle_ocr_for_liteparse
from app.services.surya_bridge import run_surya_for_liteparse, surya_is_available

logger = logging.getLogger(__name__)

OcrRunner = Callable[[], list[dict[str, Any]]]


def _local_ocr_callback_url(path: str) -> str:
    port = os.environ.get("PORT", "8000")
    return f"http://127.0.0.1:{port}{path}"


def _first_url(*candidates: str | None) -> str | None:
    for value in candidates:
        stripped = (value or "").strip()
        if stripped:
            return stripped
    return None


def resolve_fast_ocr_server_url(settings: Settings | None = None) -> str:
    """URL LiteParse uses for the fast chain (default: local ``/api/ocr/fast``)."""
    settings = settings or get_settings()
    explicit = _first_url(settings.ocr_fast_server_url, settings.easyocr_ocr_server_url)
    if explicit:
        return explicit
    return _local_ocr_callback_url("/api/ocr/fast")


def resolve_deep_ocr_server_url(settings: Settings | None = None) -> str:
    """URL LiteParse uses for the deep chain (default: local ``/api/ocr/deep``)."""
    settings = settings or get_settings()
    explicit = (settings.ocr_deep_server_url or "").strip()
    if explicit:
        return explicit
    return _local_ocr_callback_url("/api/ocr/deep")


def resolve_unified_ocr_server_url(settings: Settings | None = None) -> str:
    """URL for a single auto-escalating callback (default: local ``/api/ocr``)."""
    settings = settings or get_settings()
    explicit = _first_url(
        settings.ocr_unified_server_url,
        settings.liteparse_ocr_server_url,
    )
    if explicit:
        return explicit
    return _local_ocr_callback_url("/api/ocr")


def _fast_runners(
    image_bytes: bytes,
    *,
    language: str,
    settings: Settings,
) -> list[tuple[str, OcrRunner]]:
    spec = PipelineSpec.from_settings(settings)
    runners: list[tuple[str, OcrRunner]] = []
    if spec.ocr_backend_enabled("easyocr") and easyocr_is_available():
        runners.append(
            (
                "easyocr",
                lambda: run_easyocr_for_liteparse(
                    image_bytes, language=language, settings=settings
                ),
            )
        )
    return runners


def _deep_runners(
    image_bytes: bytes,
    *,
    language: str,
    suffix: str,
    settings: Settings,
) -> list[tuple[str, OcrRunner]]:
    spec = PipelineSpec.from_settings(settings)
    runners: list[tuple[str, OcrRunner]] = []
    from app.processing import paddle_gate

    if paddle_gate.liteparse_may_use_paddle(settings):
        runners.append(
            (
                "paddle",
                lambda: run_paddle_ocr_for_liteparse(
                    image_bytes, language=language, suffix=suffix, settings=settings
                ),
            )
        )
    if spec.ocr_backend_enabled("surya") and surya_is_available():
        runners.append(
            (
                "surya",
                lambda: run_surya_for_liteparse(
                    image_bytes, language=language, settings=settings
                ),
            )
        )
    return runners


def _run_chain(
    runners: list[tuple[str, OcrRunner]],
    *,
    chain_label: str,
) -> tuple[list[dict[str, Any]], str]:
    if not runners:
        raise RuntimeError(f"No OCR backends are enabled for {chain_label} chain")

    best: tuple[list[dict[str, Any]], str] | None = None
    for backend, run in runners:
        try:
            results = run()
        except Exception as exc:  # noqa: BLE001
            logger.warning("%s chain backend %s failed: %s", chain_label, backend, exc)
            continue
        if not ocr_results_are_weak(results):
            logger.info("%s chain selected backend=%s", chain_label, backend)
            return results, backend
        logger.info("%s chain backend %s weak — trying next", chain_label, backend)
        best = (results, backend)

    if best is not None:
        logger.info("%s chain using best weak result from backend=%s", chain_label, best[1])
        return best

    raise RuntimeError(f"All {chain_label} OCR backends failed or returned empty results")


def run_fast_ocr_chain(
    image_bytes: bytes,
    *,
    language: str = "en",
    settings: Settings | None = None,
) -> tuple[list[dict[str, Any]], str]:
    settings = settings or get_settings()
    return _run_chain(
        _fast_runners(image_bytes, language=language, settings=settings),
        chain_label="fast",
    )


def run_deep_ocr_chain(
    image_bytes: bytes,
    *,
    language: str = "en",
    suffix: str = ".png",
    settings: Settings | None = None,
) -> tuple[list[dict[str, Any]], str]:
    settings = settings or get_settings()
    return _run_chain(
        _deep_runners(image_bytes, language=language, suffix=suffix, settings=settings),
        chain_label="deep",
    )


def run_unified_ocr_for_liteparse(
    image_bytes: bytes,
    *,
    language: str = "en",
    suffix: str = ".png",
    settings: Settings | None = None,
) -> tuple[list[dict[str, Any]], str]:
    settings = settings or get_settings()
    fast_runners = _fast_runners(image_bytes, language=language, settings=settings)
    if fast_runners:
        try:
            results, backend = _run_chain(fast_runners, chain_label="fast")
            if not ocr_results_are_weak(results):
                return results, backend
        except RuntimeError:
            logger.info("Fast OCR chain unavailable or failed — trying deep chain")

    results, backend = run_deep_ocr_chain(
        image_bytes, language=language, suffix=suffix, settings=settings
    )
    return results, f"deep:{backend}"
