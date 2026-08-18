"""EasyOCR bridge for LiteParse's HTTP OCR API."""

from __future__ import annotations

import io
import logging
import threading
from typing import Any

from PIL import Image

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

_reader_lock = threading.Lock()
_reader: Any = None
_reader_language: str | None = None


def easyocr_is_available() -> bool:
    try:
        import easyocr  # noqa: F401

        return True
    except ImportError:
        return False


def normalize_easyocr_language(language: str) -> str:
    normalized = (language or "en").strip().lower()
    aliases = {
        "en": "en",
        "eng": "en",
        "zh": "ch_sim",
        "zh-cn": "ch_sim",
        "zh-hans": "ch_sim",
        "zh-tw": "ch_tra",
        "zh-hant": "ch_tra",
        "ja": "ja",
        "jp": "ja",
        "ko": "ko",
        "fr": "fr",
        "de": "de",
        "es": "es",
        "ar": "ar",
    }
    return aliases.get(normalized, normalized)


def resolve_easyocr_ocr_server_url(settings: Settings | None = None) -> str:
    """Legacy alias — same resolution as ``resolve_fast_ocr_server_url``."""
    from app.processing.strategy.ocr.chains import resolve_fast_ocr_server_url

    return resolve_fast_ocr_server_url(settings)


def run_easyocr_for_liteparse(
    image_bytes: bytes,
    *,
    language: str = "en",
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """Run EasyOCR on one image; return LiteParse OCR API result objects."""
    settings = settings or get_settings()
    lang = normalize_easyocr_language(language)
    reader = _get_reader(lang, gpu=settings.easyocr_use_gpu, settings=settings)

    image = Image.open(io.BytesIO(image_bytes))
    if image.mode != "RGB":
        image = image.convert("RGB")

    import numpy as np

    results = reader.readtext(np.array(image))

    formatted: list[dict[str, Any]] = []
    for coords, text, confidence in results:
        if not isinstance(text, str) or not text.strip():
            continue
        if hasattr(coords, "tolist"):
            coords = coords.tolist()
        try:
            xs = [float(point[0]) for point in coords]
            ys = [float(point[1]) for point in coords]
        except (TypeError, ValueError, IndexError):
            continue
        bbox = [min(xs), min(ys), max(xs), max(ys)]
        formatted.append(
            {
                "text": text.strip(),
                "bbox": bbox,
                "confidence": float(confidence),
            }
        )
    return formatted


def _get_reader(language: str, *, gpu: bool, settings: Settings | None = None) -> Any:
    global _reader, _reader_language
    settings = settings or get_settings()
    with _reader_lock:
        if _reader is None or _reader_language != language:
            import easyocr

            logger.info("Loading EasyOCR reader (lang=%s, gpu=%s)", language, gpu)
            kwargs: dict[str, object] = {"gpu": gpu}
            if settings.easyocr_model_dir:
                kwargs["model_storage_directory"] = settings.easyocr_model_dir
                kwargs["download_enabled"] = False
            _reader = easyocr.Reader([language], **kwargs)
            _reader_language = language
        return _reader
