"""PP-OCR bridge for LiteParse's HTTP OCR API (POST /ocr)."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings
from app.services.options import ExtractOptions

logger = logging.getLogger(__name__)


def normalize_ocr_language(language: str) -> str:
    """Map LiteParse / ISO codes to PaddleOCR lang codes."""
    normalized = (language or "en").strip().lower()
    aliases = {
        "en": "en",
        "eng": "en",
        "zh": "ch",
        "zh-cn": "ch",
        "zh-hans": "ch",
        "zh-tw": "chinese_cht",
        "zh-hant": "chinese_cht",
        "ja": "japan",
        "jp": "japan",
        "ko": "korean",
        "fr": "french",
        "de": "german",
        "es": "es",
        "ar": "ar",
    }
    return aliases.get(normalized, normalized)


def resolve_paddle_ocr_server_url(settings: Settings | None = None) -> str:
    """PP-OCR HTTP endpoint — prefer unified ``/api/ocr`` for LiteParse."""
    from app.services.unified_ocr import resolve_unified_ocr_server_url

    settings = settings or get_settings()
    explicit = (settings.liteparse_ocr_server_url or "").strip()
    if explicit:
        return explicit
    return resolve_unified_ocr_server_url(settings)


def resolve_liteparse_ocr_server_url(settings: Settings | None = None) -> str | None:
    """Legacy: single Paddle OCR URL when not using the tier chain."""
    settings = settings or get_settings()
    if (settings.liteparse_ocr_server_url or "").strip():
        return (settings.liteparse_ocr_server_url or "").strip()
    if settings.liteparse_use_paddle_ocr:
        return resolve_paddle_ocr_server_url(settings)
    return None


def run_paddle_ocr_for_liteparse(
    image_bytes: bytes,
    *,
    language: str = "en",
    suffix: str = ".png",
    settings: Settings | None = None,
) -> list[dict[str, Any]]:
    """Run PP-OCR on one image and return LiteParse OCR API result objects."""
    del language  # PP-OCR lang is fixed at engine init; param kept for API compatibility.
    settings = settings or get_settings()
    work_dir = settings.upload_dir
    work_dir.mkdir(parents=True, exist_ok=True)
    path = work_dir / f"ocr-bridge-{uuid.uuid4().hex}{suffix}"
    path.write_bytes(image_bytes)

    try:
        from app.services.ocr import get_ocr_service

        engine = get_ocr_service().registry.get("ocr")
        engine.ensure_ready()
        extracted = engine.extract(
            path,
            output_format="json",
            options=ExtractOptions(use_region_detection=False),
            mime_type="image/png",
        )
        return _format_paddle_json(extracted.json_data)
    finally:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def _format_paddle_json(json_data: Any) -> list[dict[str, Any]]:
    payload = json_data
    if isinstance(payload, dict) and "pages" in payload and isinstance(payload["pages"], list):
        if len(payload["pages"]) == 1 and isinstance(payload["pages"][0], dict):
            payload = payload["pages"][0]
        elif payload["pages"]:
            payload = payload["pages"][0]

    if isinstance(payload, dict) and "res" in payload and isinstance(payload["res"], dict):
        payload = payload["res"]

    if not isinstance(payload, dict):
        return []

    texts = payload.get("rec_texts") or payload.get("texts") or []
    scores = payload.get("rec_scores") or payload.get("scores") or []
    boxes = payload.get("rec_boxes") or payload.get("boxes") or []
    polys = payload.get("rec_polys") or payload.get("dt_polys") or []

    formatted: list[dict[str, Any]] = []
    for index, text in enumerate(texts):
        if not isinstance(text, str) or not text.strip():
            continue
        confidence = 1.0
        if isinstance(scores, list) and index < len(scores):
            try:
                confidence = float(scores[index])
            except (TypeError, ValueError):
                confidence = 1.0

        bbox = _as_bbox(boxes[index] if index < len(boxes) else None)
        if bbox is None:
            bbox = [0.0, 0.0, 0.0, 0.0]

        item: dict[str, Any] = {
            "text": text.strip(),
            "bbox": bbox,
            "confidence": confidence,
        }
        polygon = _as_polygon(polys[index] if index < len(polys) else None)
        if polygon is not None:
            item["polygon"] = polygon
            if bbox == [0.0, 0.0, 0.0, 0.0]:
                xs = [p[0] for p in polygon]
                ys = [p[1] for p in polygon]
                item["bbox"] = [min(xs), min(ys), max(xs), max(ys)]
        formatted.append(item)
    return formatted


def _as_bbox(raw: Any) -> list[float] | None:
    if not isinstance(raw, (list, tuple)) or len(raw) < 4:
        return None
    try:
        x1, y1, x2, y2 = (float(raw[0]), float(raw[1]), float(raw[2]), float(raw[3]))
    except (TypeError, ValueError):
        return None
    if x2 <= x1 or y2 <= y1:
        return None
    return [x1, y1, x2, y2]


def _as_polygon(raw: Any) -> list[list[float]] | None:
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    try:
        points = [[float(p[0]), float(p[1])] for p in raw]
    except (TypeError, ValueError, IndexError):
        return None
    if not all(len(p) == 2 for p in points):
        return None
    return points
