"""Project StructureDocument → markdown + regions (views only)."""

from __future__ import annotations

import re

from app.processing.structure.schema import StructureBlock, StructureDocument, StructureTable


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

_IGNORE = {
    "number",
    "header",
    "header_image",
    "footer",
    "footer_image",
    "formula_number",
}


def _heading(level: int, text: str) -> str:
    level = max(1, min(level, 6))
    body = text.lstrip("#").strip()
    return f"{'#' * level} {body}" if body else ""


def _table_to_html(table: StructureTable) -> str:
    if table.html and "<table" in table.html.lower():
        return table.html
    if not table.cells or table.rows <= 0 or table.cols <= 0:
        return ""
    grid: list[list[str | None]] = [[None for _ in range(table.cols)] for _ in range(table.rows)]
    skip: set[tuple[int, int]] = set()
    for cell in table.cells:
        for dr in range(cell.rs):
            for dc in range(cell.cs):
                rr, cc = cell.r + dr, cell.c + dc
                if 0 <= rr < table.rows and 0 <= cc < table.cols:
                    if dr == 0 and dc == 0:
                        grid[rr][cc] = cell.text
                    else:
                        skip.add((rr, cc))
    rows_html: list[str] = []
    for r in range(table.rows):
        cells_html: list[str] = []
        for c in range(table.cols):
            if (r, c) in skip:
                continue
            origin = next((cell for cell in table.cells if cell.r == r and cell.c == c), None)
            text = (origin.text if origin else grid[r][c]) or ""
            rs = origin.rs if origin else 1
            cs = origin.cs if origin else 1
            attrs = ""
            if rs > 1:
                attrs += f' rowspan="{rs}"'
            if cs > 1:
                attrs += f' colspan="{cs}"'
            if origin and origin.align:
                attrs += f' align="{_escape(origin.align)}"'
            if origin and origin.style:
                attrs += f' style="{_escape(origin.style)}"'
            tag = "th" if origin and origin.is_header else "td"
            content = origin.html if origin and origin.html else _escape(text)
            cells_html.append(f"<{tag}{attrs}>{content}</{tag}>")
        rows_html.append("<tr>" + "".join(cells_html) + "</tr>")
    return "<table>\n" + "\n".join(rows_html) + "\n</table>"


def _escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _block_markdown(block: StructureBlock) -> str:
    label = (block.label or "text").lower().strip()
    if label in _IGNORE:
        return ""
    text = (block.text or "").strip()
    rich = (block.rich_text or "").strip()

    if label in _TITLE_LABELS:
        if rich:
            return rich
        return _heading(block.title_level or _TITLE_LABELS[label], text)

    if label == "table":
        if block.table:
            return _table_to_html(block.table)
        return text

    if label == "formula":
        if text.startswith("$"):
            return text
        body = (block.formula or text).strip()
        return f"$$\n{body}\n$$" if body else ""

    if label in {"algorithm", "code"}:
        if text.startswith("```"):
            return text
        return f"```\n{text}\n```" if text else ""

    if label in {"image", "chart", "seal"}:
        if block.image_ref:
            return block.image_ref
        if text.startswith("![") or text.startswith("<img") or text.startswith("<div"):
            return text
        return f"*{text}*" if text else ""

    if label == "aside_text" and (rich or text):
        return f"<aside>{rich or text}</aside>"
    if label == "footnote" and (rich or text):
        return f"<small>{rich or text}</small>"
    return rich or text


def project_markdown(doc: StructureDocument) -> str:
    ordered = sorted(
        doc.blocks,
        key=lambda b: (
            b.page,
            b.order is None,
            b.order if isinstance(b.order, (int, float)) else 10**9,
        ),
    )
    parts: list[str] = []
    current_page: int | None = None
    multi = doc.page_count > 1 or len({b.page for b in doc.blocks}) > 1
    for block in ordered:
        if multi and current_page is not None and block.page != current_page:
            parts.append("---")
        current_page = block.page
        md = _block_markdown(block)
        if md:
            parts.append(md)
    text = "\n\n".join(parts).strip()
    return re.sub(r"\n{3,}", "\n\n", text)


def project_regions(doc: StructureDocument) -> list[dict]:
    return doc.to_regions()
