"""Render StructureDocument to HTML / plain projections for exporters."""

from __future__ import annotations

import html
import json

from app.processing.structure.project import project_markdown
from app.processing.structure.schema import StructureBlock, StructureDocument, StructureTable


def structure_to_html(doc: StructureDocument, *, title: str = "Document") -> str:
    body = _document_body(doc)
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '  <meta charset="utf-8" />\n'
        f"  <title>{html.escape(title)}</title>\n"
        "  <style>\n"
        "    body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.55; "
        "max-width: 48rem; margin: 2rem auto; padding: 0 1.25rem; color: #1a1a1a; }\n"
        "    img { max-width: 100%; height: auto; }\n"
        "    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }\n"
        "    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; }\n"
        "    pre { background: #f6f6f4; padding: 0.85rem 1rem; overflow: auto; }\n"
        "    .fw-layout-page { position: relative; max-width: 60rem; margin: 1rem auto; "
        "border: 1px solid #ddd; background: #fff; overflow: hidden; }\n"
        "    .fw-layout-block { position: absolute; box-sizing: border-box; overflow: visible; }\n"
        "    .fw-layout-block > :first-child { margin-top: 0; }\n"
        "    .fw-layout-block > :last-child { margin-bottom: 0; }\n"
        "  </style>\n"
        "</head>\n"
        f"<body>\n{body}\n</body>\n"
        "</html>\n"
    )


def structure_to_json_bytes(doc: StructureDocument, *, title: str = "document", markdown: str = "") -> bytes:
    payload = {
        "title": title,
        "markdown": markdown or project_markdown(doc),
        "structure": doc.model_dump(mode="json"),
    }
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


def _ordered(doc: StructureDocument) -> list[StructureBlock]:
    return sorted(
        doc.blocks,
        key=lambda b: (
            b.page,
            b.order is None,
            b.order if isinstance(b.order, (int, float)) else 10**9,
        ),
    )


def _document_body(doc: StructureDocument) -> str:
    ordered = _ordered(doc)
    page_sizes = doc.meta.get("page_sizes") if isinstance(doc.meta, dict) else None
    parts: list[str] = []
    for page in sorted({block.page for block in ordered}):
        blocks = [block for block in ordered if block.page == page]
        size = page_sizes.get(str(page)) if isinstance(page_sizes, dict) else None
        if isinstance(size, dict) and _has_columns(blocks):
            try:
                width = float(size["width"])
                height = float(size["height"])
            except (KeyError, TypeError, ValueError):
                width = height = 0
            if width > 0 and height > 0:
                parts.append(_layout_page(blocks, page=page, width=width, height=height))
                continue
        parts.extend(chunk for block in blocks if (chunk := _block_html(block)))
    return "\n".join(parts)


def _has_columns(blocks: list[StructureBlock]) -> bool:
    boxed = [block for block in blocks if block.bbox and len(block.bbox) >= 4]
    for index, left in enumerate(boxed):
        assert left.bbox is not None
        lx1, ly1, lx2, ly2 = left.bbox[:4]
        for right in boxed[index + 1 :]:
            assert right.bbox is not None
            rx1, ry1, rx2, ry2 = right.bbox[:4]
            vertical_overlap = min(ly2, ry2) - max(ly1, ry1)
            min_height = min(ly2 - ly1, ry2 - ry1)
            separated = lx2 <= rx1 or rx2 <= lx1
            if separated and min_height > 0 and vertical_overlap / min_height >= 0.35:
                return True
    return False


def _layout_page(
    blocks: list[StructureBlock],
    *,
    page: int,
    width: float,
    height: float,
) -> str:
    chunks: list[str] = []
    for block in blocks:
        if not block.bbox or len(block.bbox) < 4:
            continue
        chunk = _block_html(block)
        if not chunk:
            continue
        x1, y1, x2, _y2 = block.bbox[:4]
        left = max(0.0, min(100.0, x1 / width * 100))
        top = max(0.0, min(100.0, y1 / height * 100))
        block_width = max(1.0, min(100.0 - left, (x2 - x1) / width * 100))
        chunks.append(
            '<div class="fw-layout-block" '
            f'data-block-id="{html.escape(block.id)}" '
            f'style="left:{left:.3f}%;top:{top:.3f}%;width:{block_width:.3f}%">'
            f"{chunk}</div>"
        )
    ratio = height / width * 100
    return (
        f'<section class="fw-layout-page" data-page="{page}" '
        f'style="padding-top:{ratio:.3f}%">{"".join(chunks)}</section>'
    )


def _block_html(block: StructureBlock) -> str:
    label = (block.label or "text").lower()
    text = block.text or ""
    rich = block.rich_text or ""
    if label in {
        "number",
        "header",
        "header_image",
        "footer",
        "footer_image",
        "formula_number",
    }:
        return ""

    title_map = {
        "doc_title": 1,
        "paragraph_title": 2,
        "figure_title": 3,
        "table_title": 3,
        "chart_title": 3,
        "content_title": 2,
    }
    if label in title_map:
        if rich:
            return rich
        level = title_map[label]
        return f"<h{level}>{html.escape(text.lstrip('#').strip())}</h{level}>" if text.strip() else ""

    if label == "table":
        if block.table:
            return _table_html(block.table)
        if "<table" in text.lower():
            return text
        return f"<p>{html.escape(text)}</p>" if text else ""

    if label == "formula":
        body = html.escape(block.formula or text)
        return f"<pre class=\"formula\">{body}</pre>" if body else ""

    if label in {"algorithm", "code"}:
        return f"<pre><code>{html.escape(text)}</code></pre>" if text else ""

    if label in {"image", "chart", "seal"}:
        ref = block.image_ref or text
        if ref.startswith("![") or ref.startswith("<img") or ref.startswith("<div"):
            return ref
        return f"<p><em>{html.escape(text)}</em></p>" if text else ""

    if label == "aside_text" and (rich or text):
        return f"<aside>{rich or html.escape(text)}</aside>"
    if label == "footnote" and (rich or text):
        return f"<small>{rich or html.escape(text)}</small>"
    if rich:
        return rich
    if not text.strip():
        return ""
    if text.startswith("<"):
        return text
    return f"<p>{html.escape(text)}</p>"


def _table_html(table: StructureTable) -> str:
    if table.html and "<table" in table.html.lower():
        return table.html
    if not table.cells:
        return ""
    rows = max(table.rows, max((c.r + c.rs for c in table.cells), default=0))
    cols = max(table.cols, max((c.c + c.cs for c in table.cells), default=0))
    skip: set[tuple[int, int]] = set()
    origin = {(c.r, c.c): c for c in table.cells}
    for cell in table.cells:
        for dr in range(cell.rs):
            for dc in range(cell.cs):
                if dr or dc:
                    skip.add((cell.r + dr, cell.c + dc))
    row_bits: list[str] = []
    for r in range(rows):
        cells: list[str] = []
        for c in range(cols):
            if (r, c) in skip:
                continue
            cell = origin.get((r, c))
            if cell is None:
                cells.append("<td></td>")
                continue
            attrs = ""
            if cell.rs > 1:
                attrs += f' rowspan="{cell.rs}"'
            if cell.cs > 1:
                attrs += f' colspan="{cell.cs}"'
            if cell.align:
                attrs += f' align="{html.escape(cell.align)}"'
            if cell.style:
                attrs += f' style="{html.escape(cell.style)}"'
            tag = "th" if cell.is_header else "td"
            content = cell.html or html.escape(cell.text)
            cells.append(f"<{tag}{attrs}>{content}</{tag}>")
        row_bits.append("<tr>" + "".join(cells) + "</tr>")
    return "<table>\n" + "\n".join(row_bits) + "\n</table>"
