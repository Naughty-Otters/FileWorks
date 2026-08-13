"""Normalize layout blocks into UI-friendly recognition regions."""

from __future__ import annotations

import re
from typing import Any


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


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


def _unwrap_page_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    if "parsing_res_list" in payload or "layout_det_res" in payload:
        return payload
    res = payload.get("res")
    if isinstance(res, dict):
        return res
    pages = payload.get("pages")
    if isinstance(pages, list) and pages:
        first = pages[0]
        if isinstance(first, dict):
            inner = first.get("json")
            if isinstance(inner, dict):
                return _unwrap_page_payload(inner)
            return first
    return payload


def extract_regions(
    payload: Any,
    *,
    page: int = 1,
) -> tuple[list[dict[str, Any]], dict[str, float] | None]:
    """Return (regions, image_size) from StructureV3 / OCR JSON."""
    data = _unwrap_page_payload(payload)
    width = data.get("width")
    height = data.get("height")
    image_size = None
    try:
        if width is not None and height is not None:
            image_size = {"width": float(width), "height": float(height)}
    except (TypeError, ValueError):
        image_size = None

    regions: list[dict[str, Any]] = []
    parsing = data.get("parsing_res_list")
    if isinstance(parsing, list) and parsing:
        ordered = sorted(
            [b for b in parsing if isinstance(b, dict)],
            key=lambda b: (
                b.get("block_order") is None,
                b.get("block_order") if isinstance(b.get("block_order"), (int, float)) else 10**9,
                b.get("block_id") if isinstance(b.get("block_id"), (int, float)) else 10**9,
            ),
        )
        for index, block in enumerate(ordered):
            bbox = _as_bbox(block.get("block_bbox") or block.get("bbox") or block.get("coordinate"))
            if bbox is None:
                continue
            label = str(block.get("block_label") or block.get("label") or "text")
            text = _clean_text(block.get("block_content") or block.get("content") or "")
            block_id = block.get("block_id")
            regions.append(
                {
                    "id": str(block_id if block_id is not None else index),
                    "page": page,
                    "label": label,
                    "text": text,
                    "bbox": bbox,
                    "order": block.get("block_order") if isinstance(block.get("block_order"), (int, float)) else index + 1,
                    "score": None,
                }
            )
        return regions, image_size

    # Fallback: layout detection boxes only
    layout = data.get("layout_det_res")
    boxes = layout.get("boxes") if isinstance(layout, dict) else None
    if isinstance(boxes, list):
        for index, box in enumerate(boxes):
            if not isinstance(box, dict):
                continue
            bbox = _as_bbox(box.get("coordinate") or box.get("bbox"))
            if bbox is None:
                continue
            score = box.get("score")
            try:
                score_f = float(score) if score is not None else None
            except (TypeError, ValueError):
                score_f = None
            regions.append(
                {
                    "id": str(index),
                    "page": page,
                    "label": str(box.get("label") or "region"),
                    "text": "",
                    "bbox": bbox,
                    "order": index + 1,
                    "score": score_f,
                }
            )
    return regions, image_size
