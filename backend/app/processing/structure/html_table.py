"""Parse HTML tables into a StructureTable cell grid."""

from __future__ import annotations

import re
from html import escape
from html.parser import HTMLParser

from app.processing.structure.rich_text import parse_rich_text
from app.processing.structure.schema import StructureTable, StructureTableCell


class _TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[tuple[str, str, int, int, bool, str | None, str | None]]] = []
        self._row: list[tuple[str, str, int, int, bool, str | None, str | None]] | None = None
        self._cell_text: list[str] | None = None
        self._cell_html: list[str] | None = None
        self._rs = 1
        self._cs = 1
        self._is_header = False
        self._align: str | None = None
        self._style: str | None = None
        self._in_cell = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        name = tag.lower()
        attr = {k.lower(): (v or "") for k, v in attrs}
        if name == "tr":
            self._row = []
        elif name in {"td", "th"} and self._row is not None:
            self._in_cell = True
            self._cell_text = []
            self._cell_html = []
            self._is_header = name == "th"
            self._align = attr.get("align") or None
            self._style = attr.get("style") or None
            try:
                self._rs = max(1, int(attr.get("rowspan") or "1"))
            except ValueError:
                self._rs = 1
            try:
                self._cs = max(1, int(attr.get("colspan") or "1"))
            except ValueError:
                self._cs = 1
        elif self._in_cell and self._cell_html is not None:
            raw = self.get_starttag_text()
            self._cell_html.append(raw if raw else f"<{name}>")

    def handle_endtag(self, tag: str) -> None:
        name = tag.lower()
        if name in {"td", "th"} and self._in_cell and self._row is not None:
            text = re.sub(r"\s+", " ", "".join(self._cell_text or [])).strip()
            rich = "".join(self._cell_html or []).strip()
            self._row.append(
                (text, rich, self._rs, self._cs, self._is_header, self._align, self._style)
            )
            self._in_cell = False
            self._cell_text = None
            self._cell_html = None
        elif name == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None
        elif self._in_cell and self._cell_html is not None:
            self._cell_html.append(f"</{name}>")

    def handle_data(self, data: str) -> None:
        if self._in_cell and self._cell_text is not None:
            self._cell_text.append(data)
            if self._cell_html is not None:
                self._cell_html.append(escape(data))


def parse_html_table(html: str) -> StructureTable | None:
    body = (html or "").strip()
    if "<table" not in body.lower():
        return None
    parser = _TableParser()
    try:
        parser.feed(body)
    except Exception:  # noqa: BLE001
        return None
    if not parser.rows:
        return None

    # Place cells into a grid accounting for prior row/col spans.
    occupancy: dict[tuple[int, int], StructureTableCell] = {}
    max_r = 0
    max_c = 0
    for r_idx, row in enumerate(parser.rows):
        c = 0
        for text, rich, rs, cs, is_header, align, style in row:
            while (r_idx, c) in occupancy:
                c += 1
            runs, _alignment = parse_rich_text(rich)
            cell = StructureTableCell(
                r=r_idx,
                c=c,
                text=text,
                rs=rs,
                cs=cs,
                html=rich or None,
                is_header=is_header,
                align=align,
                style=style,
                runs=runs,
            )
            for dr in range(rs):
                for dc in range(cs):
                    occupancy[(r_idx + dr, c + dc)] = cell
            max_r = max(max_r, r_idx + rs)
            max_c = max(max_c, c + cs)
            c += cs

    # Deduplicate origin cells only.
    seen: set[tuple[int, int]] = set()
    cells: list[StructureTableCell] = []
    for (r, c), cell in sorted(occupancy.items()):
        if (cell.r, cell.c) in seen:
            continue
        if r == cell.r and c == cell.c:
            seen.add((cell.r, cell.c))
            cells.append(cell)

    return StructureTable(rows=max_r, cols=max_c, cells=cells, html=body)
