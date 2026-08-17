"""Rebuild structured Markdown from PP-StructureV3 layout blocks.

PP-StructureV3 already emits Markdown, but we normalize it and can reconstruct
from ``parsing_res_list`` when the built-in markdown is sparse — preserving
titles, tables, formulas, and emphasis so the UI can recover document layout.
"""

from __future__ import annotations

import re
from typing import Any


_TITLE_LABELS = {
    "doc_title": 1,
    "paragraph_title": 2,
    "figure_title": 3,
    "table_title": 3,
    "chart_title": 3,
    "figure_table_chart_title": 3,
    "content_title": 2,
    "abstract_title": 2,
    "reference_title": 2,
}

_IMAGE_LABELS = {"image", "chart", "seal"}
_IMAGE_MARKUP_RE = re.compile(
    r'(?:<div[^>]*>\s*)?(?:!\[[^\]]*\]\([^)]+\)|<img\b[^>]*/?>)(?:\s*</div>)?',
    flags=re.IGNORECASE | re.DOTALL,
)
_EMPHASIS_LABELS = {"abstract", "content", "reference", "reference_content"}
_IGNORE_LABELS = {
    "number",
    "footnote",
    "header",
    "header_image",
    "footer",
    "footer_image",
    "aside_text",
    "formula_number",
}


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (list, tuple)):
        return "\n".join(_as_text(v) for v in value if v is not None)
    return str(value)


def _clean_block(text: str) -> str:
    return re.sub(r"[ \t]+\n", "\n", text).strip()


def _heading(level: int, text: str) -> str:
    level = max(1, min(level, 6))
    body = _clean_block(text).lstrip("#").strip()
    if not body:
        return ""
    return f"{'#' * level} {body}"


def _looks_like_html_table(text: str) -> bool:
    lower = text.lower()
    return "<table" in lower or "<tr" in lower


def _looks_like_md_table(text: str) -> bool:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return False
    return all("|" in ln for ln in lines[:3])


def _format_table(content: str) -> str:
    body = _clean_block(content)
    if not body:
        return ""
    if _looks_like_html_table(body) or _looks_like_md_table(body):
        return body
    # Plain multi-line cell dump → simple markdown table-ish block
    rows = [ln for ln in body.splitlines() if ln.strip()]
    if len(rows) >= 2 and "\t" in rows[0]:
        cells0 = [c.strip() for c in rows[0].split("\t")]
        header = "| " + " | ".join(cells0) + " |"
        sep = "| " + " | ".join("---" for _ in cells0) + " |"
        body_rows = []
        for row in rows[1:]:
            cells = [c.strip() for c in row.split("\t")]
            while len(cells) < len(cells0):
                cells.append("")
            body_rows.append("| " + " | ".join(cells[: len(cells0)]) + " |")
        return "\n".join([header, sep, *body_rows])
    return body


def _format_formula(content: str) -> str:
    body = _clean_block(content)
    if not body:
        return ""
    if body.startswith("$$") or body.startswith("$"):
        return body
    return f"$$\n{body}\n$$"


def _format_code(content: str) -> str:
    body = _clean_block(content)
    if not body:
        return ""
    if body.startswith("```"):
        return body
    return f"```\n{body}\n```"


def _format_text(content: str, *, emphasize: bool = False) -> str:
    body = _clean_block(content)
    if not body:
        return ""
    # Preserve inline markdown/HTML already present
    if emphasize and not re.search(r"[*_`<]", body):
        return f"**{body}**"
    return body


def _block_to_markdown(block: dict[str, Any]) -> str:
    label = str(block.get("block_label") or block.get("label") or "text").lower().strip()
    content = _as_text(block.get("block_content") or block.get("content") or "")
    title_level = block.get("title_level") or block.get("level")

    if label in _IGNORE_LABELS:
        return ""

    if label in _TITLE_LABELS:
        level = int(title_level) if isinstance(title_level, (int, float)) else _TITLE_LABELS[label]
        return _heading(level, content)

    if label in {"table"}:
        return _format_table(content)

    if label in {"formula"}:
        return _format_formula(content)

    if label in {"algorithm", "code"}:
        return _format_code(content)

    if label in _IMAGE_LABELS:
        body = _clean_block(content)
        if body.startswith("![") or body.startswith("<img") or body.startswith("<div"):
            return body
        return f"*{body}*" if body else ""

    if label in {"figure_title", "table_title", "chart_title", "figure_table_chart_title"}:
        return _heading(3, content) if content else ""

    if label in _EMPHASIS_LABELS:
        return _format_text(content, emphasize=False)

    return _format_text(content)


def _extract_parsing_list(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []

    candidates = [
        payload.get("parsing_res_list"),
        payload.get("layout_parsing_result"),
    ]
    res = payload.get("res")
    if isinstance(res, dict):
        candidates.extend(
            [
                res.get("parsing_res_list"),
                res.get("layout_parsing_result"),
            ]
        )

    for candidate in candidates:
        if isinstance(candidate, list) and candidate:
            return [item for item in candidate if isinstance(item, dict)]
    return []


def _extract_image_markup(markdown: str) -> list[str]:
    if not markdown:
        return []
    return [match.group(0).strip() for match in _IMAGE_MARKUP_RE.finditer(markdown)]


def markdown_from_parsing_blocks(payload: Any, *, image_markup: list[str] | None = None) -> str:
    blocks = _extract_parsing_list(payload)
    if not blocks:
        return ""

    # Prefer reading order when present
    ordered = sorted(
        blocks,
        key=lambda b: (
            b.get("block_order") is None,
            b.get("block_order") if isinstance(b.get("block_order"), (int, float)) else 10**9,
            b.get("block_id") if isinstance(b.get("block_id"), (int, float)) else 10**9,
        ),
    )

    slots = list(image_markup or [])
    slot_index = 0
    parts: list[str] = []
    for block in ordered:
        label = str(block.get("block_label") or block.get("label") or "text").lower().strip()
        md = _block_to_markdown(block)
        if label in _IMAGE_LABELS:
            body = _clean_block(_as_text(block.get("block_content") or block.get("content") or ""))
            already = body.startswith("![") or body.startswith("<img") or body.startswith("<div")
            if not already and slot_index < len(slots):
                markup = slots[slot_index]
                slot_index += 1
                md = f"{markup}\n\n*{body}*" if body else markup
        if md:
            parts.append(md)
    leftover = slots[slot_index:]
    if leftover:
        parts.extend(leftover)
    return "\n\n".join(parts).strip()


def normalize_structure_markdown(raw: Any) -> str:
    """Normalize pipeline markdown (string or dict) into a clean document string."""
    if raw is None:
        return ""
    if isinstance(raw, dict):
        text = raw.get("markdown_texts") or raw.get("text") or raw.get("markdown") or ""
        if not isinstance(text, str):
            text = _as_text(text)
    else:
        text = _as_text(raw)

    text = text.replace("\r\n", "\n").strip()
    if not text:
        return ""

    # Collapse excessive blank lines while keeping paragraph breaks
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def markdown_structure_score(markdown: str) -> tuple[int, int, int, int]:
    """Count (headings, lists, tables, characters) in Markdown."""
    text = markdown or ""
    headings = len(re.findall(r"^#{1,6}\s+\S", text, flags=re.M))
    lists = len(re.findall(r"^\s*(?:[-*+]|\d+[.)])\s+\S", text, flags=re.M))
    tables = len(re.findall(r"<table\b|^\s*\|.+\|\s*$", text, flags=re.I | re.M))
    return headings, lists, tables, len(text.strip())


_LIST_STRUCTURE_RATIO = 0.05


def markdown_looks_flat(markdown: str, *, min_chars: int = 400) -> bool:
    """True when there is substantial prose but almost no headings, lists, or tables.

    Short notes and empty strings are not flat — empty is handled separately so a
    later reader can still win, and short letters should not be rejected.
    """
    text = (markdown or "").strip()
    if len(text) < min_chars:
        return False
    headings, lists, tables, _chars = markdown_structure_score(text)
    if headings or tables:
        return False
    # A raw text dump routinely has stray lines that merely open like list items
    # ("1)", "-", "25-5973 1-19"), so lists only count as structure when they are
    # a real share of the content rather than a handful of coincidences.
    lines = [line for line in text.splitlines() if line.strip()]
    return lists < max(3, len(lines) * _LIST_STRUCTURE_RATIO)


def pick_best_markdown(*, pipeline_markdown: Any, json_payload: Any) -> str:
    """Prefer rich pipeline markdown; fall back to layout-block reconstruction."""
    primary = normalize_structure_markdown(pipeline_markdown)
    rebuilt = markdown_from_parsing_blocks(
        json_payload,
        image_markup=_extract_image_markup(primary),
    )

    def richness(md: str) -> tuple[int, int, int, int, int]:
        headings, lists, tables, chars = markdown_structure_score(md)
        images = len(re.findall(r"!\[|<img\b", md, flags=re.I))
        emphasis = len(re.findall(r"\*\*[^*]+\*\*|__.+__", md))
        return (images, headings, tables, emphasis + lists, chars)

    if not primary:
        chosen = rebuilt
    elif not rebuilt:
        chosen = primary
    else:
        chosen = rebuilt if richness(rebuilt) > richness(primary) else primary

    return resolve_markdown_media(chosen, pipeline_markdown=pipeline_markdown)


def _pil_to_data_url(image: Any) -> str | None:
    """Convert a PIL image (or similar) into a data URL for Markdown/HTML embedding."""
    try:
        from io import BytesIO

        from PIL import Image
    except ImportError:
        return None

    try:
        if isinstance(image, Image.Image):
            pil = image
        elif hasattr(image, "convert"):
            pil = image
        else:
            return None
        if pil.mode not in {"RGB", "RGBA", "L"}:
            pil = pil.convert("RGB")
        buffer = BytesIO()
        pil.save(buffer, format="JPEG", quality=85)
        import base64

        encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
        return f"data:image/jpeg;base64,{encoded}"
    except Exception:  # noqa: BLE001
        return None


def _collect_image_map(raw: Any) -> dict[str, str]:
    """Build path → data-URL map from StructureV3 ``markdown_images``."""
    mapping: dict[str, str] = {}
    if not isinstance(raw, dict):
        return mapping

    for key, value in raw.items():
        path = str(key)
        data_url = _pil_to_data_url(value)
        if not data_url and isinstance(value, dict):
            data_url = _pil_to_data_url(value.get("img") or value.get("image"))
            path = str(value.get("path") or path)
        if not data_url:
            continue
        mapping[path] = data_url
        mapping[path.lstrip("./")] = data_url
        name = path.rsplit("/", 1)[-1]
        mapping[name] = data_url
        mapping[f"imgs/{name}"] = data_url
    return mapping


_IMG_MD_RE = re.compile(r"!\[([^\]]*)\]\(([^)]+)\)")
_IMG_HTML_RE = re.compile(
    r"""<img\b([^>]*?)\bsrc\s*=\s*(['"])(.*?)\2([^>]*)/?>""",
    flags=re.IGNORECASE | re.DOTALL,
)
_EMPTY_CENTER_DIV_RE = re.compile(
    r"""<div[^>]*text-align:\s*center[^>]*>\s*</div>""",
    flags=re.IGNORECASE | re.DOTALL,
)


def _lookup_data_url(src: str, images: dict[str, str]) -> str | None:
    if not src or src.startswith(("data:", "http://", "https://", "blob:")):
        return src if src.startswith("data:") else None
    cleaned = src.strip().strip("'\"")
    if cleaned in images:
        return images[cleaned]
    cleaned = cleaned.lstrip("./")
    if cleaned in images:
        return images[cleaned]
    name = cleaned.rsplit("/", 1)[-1]
    if name in images:
        return images[name]
    if f"imgs/{name}" in images:
        return images[f"imgs/{name}"]
    # Fuzzy: path suffix match
    for key, url in images.items():
        if cleaned.endswith(key) or key.endswith(cleaned) or key.endswith(name):
            return url
    return None


def resolve_markdown_media(markdown: str, *, pipeline_markdown: Any = None) -> str:
    """Embed available crop images as data URLs; drop broken local ``imgs/...`` refs."""
    if not markdown:
        return ""

    images = {}
    if isinstance(pipeline_markdown, dict):
        images.update(_collect_image_map(pipeline_markdown.get("markdown_images")))

    def replace_md(match: re.Match[str]) -> str:
        alt, src = match.group(1), match.group(2)
        data_url = _lookup_data_url(src, images)
        if data_url and data_url.startswith("data:"):
            return f"![{alt}]({data_url})"
        if src.startswith(("http://", "https://", "data:", "blob:")):
            return match.group(0)
        label = alt.strip() or "image"
        return f"*{label} omitted (not available in preview)*"

    def replace_html(match: re.Match[str]) -> str:
        pre, quote, src, post = match.group(1), match.group(2), match.group(3), match.group(4)
        data_url = _lookup_data_url(src, images)
        if data_url and data_url.startswith("data:"):
            return f"<img{pre}src={quote}{data_url}{quote}{post} />"
        if src.startswith(("http://", "https://", "data:", "blob:")):
            return match.group(0)
        return '<span class="prose-img-missing">[image omitted]</span>'

    text = _IMG_MD_RE.sub(replace_md, markdown)
    text = _IMG_HTML_RE.sub(replace_html, text)
    text = _EMPTY_CENTER_DIV_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text
