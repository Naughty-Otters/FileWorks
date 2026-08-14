"""Serialize an AnyDoc Document tree to GitHub-Flavored Markdown."""

from __future__ import annotations

import html
from typing import Any


def document_to_markdown(document: Any) -> str:
    """Walk ``Document.blocks`` and notes. Empty string if the tree has no content."""
    if document is None:
        return ""
    parts = [_block_to_markdown(block) for block in getattr(document, "blocks", None) or []]
    notes = list(getattr(document, "notes", None) or [])
    if notes:
        note_lines = []
        for note in notes:
            note_id = str(getattr(note, "id", "") or "")
            body = "\n\n".join(
                _block_to_markdown(block) for block in getattr(note, "blocks", None) or []
            ).strip()
            if not body:
                continue
            label = getattr(note, "kind", None) or "footnote"
            prefix = f"[^{note_id}]:" if note_id else f"*{label}:*"
            note_lines.append(f"{prefix} {body}")
        if note_lines:
            parts.append("\n".join(note_lines))
    return "\n\n".join(part for part in parts if part).strip()


def _inlines_to_markdown(inlines: Any) -> str:
    chunks: list[str] = []
    for inline in inlines or []:
        kind = getattr(inline, "kind", None)
        if kind == "text":
            chunks.append(_styled_text(getattr(inline, "text", None) or "", getattr(inline, "style", None)))
        elif kind == "link":
            inner = _inlines_to_markdown(getattr(inline, "content", None))
            target = getattr(inline, "target", None)
            href = getattr(target, "value", None) or ""
            if getattr(target, "kind", None) == "anchor" and href and not href.startswith("#"):
                href = f"#{href}"
            chunks.append(f"[{inner}]({href})" if href else inner)
        elif kind == "image":
            alt = (getattr(inline, "alt", None) or "").strip() or "image"
            source = getattr(inline, "source", None)
            src_kind = getattr(source, "kind", None)
            if src_kind == "external":
                url = getattr(source, "url", None) or ""
                chunks.append(f"![{alt}]({url})" if url else f"![{alt}]()")
            elif src_kind == "asset":
                asset_id = getattr(source, "asset_id", None)
                chunks.append(f"![{alt}](asset:{asset_id})")
            else:
                chunks.append(f"![{alt}]()")
        elif kind == "line_break":
            chunks.append("  \n")
        elif kind == "note_ref":
            note_id = getattr(inline, "note_id", None) or ""
            chunks.append(f"[^{note_id}]" if note_id else "")
        elif kind == "anchor":
            continue
        else:
            nested = getattr(inline, "content", None)
            if nested:
                chunks.append(_inlines_to_markdown(nested))
            else:
                chunks.append(str(getattr(inline, "text", None) or ""))
    return "".join(chunks)


def _styled_text(text: str, style: Any) -> str:
    if not text:
        return ""
    if style is None:
        return text
    out = text
    if getattr(style, "code", False):
        out = f"`{out}`"
    if getattr(style, "bold", False):
        out = f"**{out}**"
    if getattr(style, "italic", False):
        out = f"*{out}*"
    if getattr(style, "strike", False):
        out = f"~~{out}~~"
    return out


def _block_to_markdown(block: Any, *, list_depth: int = 0) -> str:
    kind = getattr(block, "kind", None)
    if kind == "heading":
        level = getattr(block, "level", None) or 1
        level = max(1, min(int(level), 6))
        body = _inlines_to_markdown(getattr(block, "content", None)).strip()
        return f"{'#' * level} {body}" if body else ""
    if kind == "paragraph":
        return _inlines_to_markdown(getattr(block, "content", None)).strip()
    if kind == "list":
        return _list_to_markdown(getattr(block, "list", None), depth=list_depth)
    if kind == "table":
        return _table_to_markdown(getattr(block, "table", None))
    if kind == "block_quote":
        inner = "\n\n".join(
            _block_to_markdown(child) for child in getattr(block, "blocks", None) or []
        ).strip()
        if not inner:
            return ""
        return "\n".join(f"> {line}" if line else ">" for line in inner.splitlines())
    if kind == "code_block":
        lang = getattr(block, "lang", None) or ""
        text = getattr(block, "text", None) or ""
        return f"```{lang}\n{text.rstrip()}\n```"
    if kind == "rule":
        return "---"
    return _inlines_to_markdown(getattr(block, "content", None)).strip()


def _list_to_markdown(lst: Any, *, depth: int) -> str:
    if lst is None:
        return ""
    marker = getattr(lst, "marker", None) or "bullet"
    start = getattr(lst, "start", None) or 1
    try:
        start = int(start)
    except (TypeError, ValueError):
        start = 1
    indent = "  " * depth
    lines: list[str] = []
    for index, item in enumerate(getattr(lst, "items", None) or []):
        checked = getattr(item, "checked", None)
        if checked is None:
            if marker == "bullet":
                bullet = "-"
            else:
                bullet = f"{start + index}."
            label = getattr(item, "marker_label", None)
            if label:
                bullet = str(label).rstrip(".")
                bullet = f"{bullet}." if marker != "bullet" else str(label)
        else:
            bullet = f"- [{'x' if checked else ' '}]"
        item_blocks = list(getattr(item, "blocks", None) or [])
        if not item_blocks:
            lines.append(f"{indent}{bullet}")
            continue
        first = _block_to_markdown(item_blocks[0], list_depth=depth + 1).strip()
        first_line, *rest_first = first.splitlines() or [""]
        lines.append(f"{indent}{bullet} {first_line}".rstrip())
        pad = indent + "  "
        for extra in rest_first:
            lines.append(f"{pad}{extra}" if extra else "")
        for nested in item_blocks[1:]:
            nested_md = _block_to_markdown(nested, list_depth=depth + 1).strip()
            for extra in nested_md.splitlines():
                lines.append(f"{pad}{extra}" if extra else "")
    return "\n".join(lines).strip()


def _table_has_spans(table: Any) -> bool:
    for row in getattr(table, "grid", None) or []:
        for slot in row or []:
            cell = getattr(slot, "cell", None)
            if cell is None:
                continue
            if int(getattr(cell, "col_span", 1) or 1) > 1 or int(getattr(cell, "row_span", 1) or 1) > 1:
                return True
    return False


def _cell_text(cell: Any) -> str:
    if cell is None:
        return ""
    parts = [_block_to_markdown(block) for block in getattr(cell, "blocks", None) or []]
    return " ".join(part.replace("\n", " ").strip() for part in parts if part).strip()


def _table_to_markdown(table: Any) -> str:
    if table is None:
        return ""
    grid = list(getattr(table, "grid", None) or [])
    if not grid:
        return ""
    if _table_has_spans(table):
        return _table_to_html(table)
    rows: list[list[str]] = []
    for row in grid:
        cells: list[str] = []
        for slot in row or []:
            if getattr(slot, "kind", None) == "covered":
                continue
            cells.append(_cell_text(getattr(slot, "cell", None)))
        if cells:
            rows.append(cells)
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    for row in rows:
        while len(row) < width:
            row.append("")
    header_rows = int(getattr(table, "header_rows", 0) or 0)
    lines = ["| " + " | ".join(rows[0]) + " |"]
    lines.append("| " + " | ".join("---" for _ in rows[0]) + " |")
    body = rows[1:] if header_rows else rows[1:]
    if header_rows == 0:
        # Still emit a GFM header row so the table renders; first row is the header.
        body = rows[1:]
    for row in body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _table_to_html(table: Any) -> str:
    header_rows = int(getattr(table, "header_rows", 0) or 0)
    parts = ["<table>"]
    for row_index, row in enumerate(getattr(table, "grid", None) or []):
        tag = "th" if row_index < header_rows else "td"
        parts.append("<tr>")
        for slot in row or []:
            if getattr(slot, "kind", None) == "covered":
                continue
            cell = getattr(slot, "cell", None)
            col_span = int(getattr(cell, "col_span", 1) or 1) if cell is not None else 1
            row_span = int(getattr(cell, "row_span", 1) or 1) if cell is not None else 1
            attrs = ""
            if col_span > 1:
                attrs += f' colspan="{col_span}"'
            if row_span > 1:
                attrs += f' rowspan="{row_span}"'
            text = html.escape(_cell_text(cell))
            parts.append(f"<{tag}{attrs}>{text}</{tag}>")
        parts.append("</tr>")
    parts.append("</table>")
    return "".join(parts)
