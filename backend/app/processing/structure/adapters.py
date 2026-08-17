"""Normalize engine-native payloads into StructureDocument (no re-recognition)."""

from __future__ import annotations

import re
from html import unescape
from typing import Any

from app.processing.models import ReadResult
from app.processing.structure.html_table import parse_html_table
from app.processing.structure.rich_text import parse_rich_text
from app.processing.structure.schema import StructureBlock, StructureDocument, StructureTable


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", unescape(text)).strip()
    return text


def _rich_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text if "<" in text and ">" in text else None


def _table_html(value: Any) -> str | None:
    if isinstance(value, str) and "<table" in value.lower():
        return value.strip()
    if not isinstance(value, dict):
        return None
    for key in ("pred_html", "html", "table_html"):
        candidate = value.get(key)
        if isinstance(candidate, str) and "<table" in candidate.lower():
            return candidate.strip()
        if isinstance(candidate, dict):
            nested = candidate.get("pred") or candidate.get("html")
            if isinstance(nested, str) and "<table" in nested.lower():
                return nested.strip()
    return None


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
    if not isinstance(raw, (list, tuple)):
        return None
    points: list[list[float]] = []
    for point in raw:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        try:
            points.append([float(point[0]), float(point[1])])
        except (TypeError, ValueError):
            continue
    return points or None


def _unwrap_page_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    if "parsing_res_list" in payload or "layout_det_res" in payload:
        return payload
    res = payload.get("res")
    if isinstance(res, dict):
        return res
    return payload


def _blocks_from_parsing_list(payload: Any, *, page: int) -> list[StructureBlock]:
    data = _unwrap_page_payload(payload)
    parsing = data.get("parsing_res_list")
    if not isinstance(parsing, list) or not parsing:
        return []
    ordered = sorted(
        [b for b in parsing if isinstance(b, dict)],
        key=lambda b: (
            b.get("block_order") is None,
            b.get("block_order") if isinstance(b.get("block_order"), (int, float)) else 10**9,
            b.get("block_id") if isinstance(b.get("block_id"), (int, float)) else 10**9,
        ),
    )
    blocks: list[StructureBlock] = []
    table_results = data.get("table_res_list")
    table_html = [
        found
        for item in (table_results if isinstance(table_results, list) else [])
        if (found := _table_html(item))
    ]
    table_index = 0
    for index, raw in enumerate(ordered):
        label = str(raw.get("block_label") or raw.get("label") or "text").strip() or "text"
        content = raw.get("block_content") or raw.get("content") or ""
        text = content if isinstance(content, str) else str(content or "")
        block_id = raw.get("block_id")
        table: StructureTable | None = None
        formula: str | None = None
        image_ref: str | None = None
        if label.lower() == "table":
            html = _table_html(text)
            if html is None and table_index < len(table_html):
                html = table_html[table_index]
            table_index += 1
            if html:
                table = parse_html_table(html)
        if label.lower() == "formula":
            formula = text.strip() or None
        if label.lower() in {"image", "chart", "seal"}:
            if text.startswith("![") or text.startswith("<img") or "data:image" in text:
                image_ref = text.strip() or None
        rich = _rich_text(text) if label.lower() != "table" else None
        runs, alignment = parse_rich_text(rich)
        blocks.append(
            StructureBlock(
                id=str(block_id if block_id is not None else f"p{page}-{index}"),
                page=page,
                label=label,
                text=_clean_text(text),
                rich_text=rich,
                runs=runs,
                alignment=alignment,
                order=raw.get("block_order")
                if isinstance(raw.get("block_order"), (int, float))
                else index + 1,
                bbox=_as_bbox(raw.get("block_bbox") or raw.get("bbox") or raw.get("coordinate")),
                polygon=_as_polygon(
                    raw.get("block_polygon_points") or raw.get("polygon") or raw.get("poly")
                ),
                group_id=str(
                    raw.get("global_group_id")
                    if raw.get("global_group_id") is not None
                    else raw.get("group_id")
                )
                if raw.get("global_group_id") is not None or raw.get("group_id") is not None
                else None,
                title_level=int(raw["title_level"])
                if isinstance(raw.get("title_level"), (int, float))
                else None,
                table=table,
                formula=formula,
                image_ref=image_ref,
            )
        )
    return blocks


def _blocks_from_regions(regions: list[dict[str, Any]]) -> list[StructureBlock]:
    blocks: list[StructureBlock] = []
    for index, region in enumerate(regions):
        if not isinstance(region, dict):
            continue
        bbox = region.get("bbox")
        if not isinstance(bbox, list) or len(bbox) < 4:
            continue
        blocks.append(
            StructureBlock(
                id=str(region.get("id") or index),
                page=int(region.get("page") or 1),
                label=str(region.get("label") or "text"),
                text=str(region.get("text") or ""),
                order=region.get("order") if isinstance(region.get("order"), (int, float)) else index + 1,
                bbox=[float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])],
                score=float(region["score"]) if isinstance(region.get("score"), (int, float)) else None,
            )
        )
    return blocks


def _blocks_from_docling_pages(pages: list[dict[str, Any]]) -> list[StructureBlock]:
    """Thin fallback when Docling only left markdown text in page json."""
    blocks: list[StructureBlock] = []
    for page in pages:
        if not isinstance(page, dict):
            continue
        page_no = int(page.get("page") or 1)
        md = str(page.get("markdown") or "").strip()
        if not md:
            continue
        blocks.append(
            StructureBlock(
                id=f"docling-p{page_no}",
                page=page_no,
                label="text",
                text=md,
                order=page_no,
            )
        )
    return blocks


def normalize_read_result(result: ReadResult) -> StructureDocument | None:
    """Build StructureDocument from ReadResult without calling any reader."""
    blocks: list[StructureBlock] = []
    pages = result.pages or []
    for page in pages:
        if not isinstance(page, dict):
            continue
        page_no = int(page.get("page") or 1)
        page_json = page.get("json")
        blocks.extend(_blocks_from_parsing_list(page_json, page=page_no))

    if not blocks:
        from app.processing.models import OutputKind

        json_out = result.output(OutputKind.JSON)
        payload = json_out.data if json_out else None
        if isinstance(payload, dict):
            if "pages" in payload and isinstance(payload["pages"], list):
                for page in payload["pages"]:
                    if not isinstance(page, dict):
                        continue
                    page_no = int(page.get("page") or 1)
                    blocks.extend(_blocks_from_parsing_list(page.get("json") or page, page=page_no))
            else:
                blocks.extend(_blocks_from_parsing_list(payload, page=1))

    if not blocks and result.regions:
        blocks = _blocks_from_regions(result.regions)

    if not blocks and result.engine_id == "docling":
        blocks = _blocks_from_docling_pages(pages)

    if not blocks:
        md = (result.markdown() or "").strip()
        if not md:
            return None
        blocks = [
            StructureBlock(id="md-0", page=1, label="text", text=md, order=1),
        ]

    page_sizes: dict[str, dict[str, float]] = {}
    for page in pages:
        if not isinstance(page, dict):
            continue
        page_no = str(int(page.get("page") or 1))
        data = _unwrap_page_payload(page.get("json"))
        try:
            width = float(data.get("width"))
            height = float(data.get("height"))
        except (TypeError, ValueError):
            continue
        if width > 0 and height > 0:
            page_sizes[page_no] = {"width": width, "height": height}
    if not page_sizes and isinstance(result.image_size, dict):
        try:
            width = float(result.image_size["width"])
            height = float(result.image_size["height"])
        except (KeyError, TypeError, ValueError):
            width = height = 0
        if width > 0 and height > 0:
            page_sizes["1"] = {"width": width, "height": height}

    return StructureDocument(
        engine=result.engine_label or result.engine_id,
        page_count=max(1, int(result.page_count or 1)),
        blocks=blocks,
        meta={
            "provider": result.engine_id,
            "native_structure": any(block.bbox or block.table for block in blocks),
            "page_sizes": page_sizes,
        },
    )
