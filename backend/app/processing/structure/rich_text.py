"""Parse OCR-produced inline HTML into portable rich-text runs."""

from __future__ import annotations

import re
from html.parser import HTMLParser

from app.processing.structure.schema import StructureTextRun, StructureTextStyle


_CSS_PROP = re.compile(r"([a-zA-Z-]+)\s*:\s*([^;]+)")
_FONT_SIZE = re.compile(r"(-?\d+(?:\.\d+)?)\s*(px|pt|rem|em)?", re.IGNORECASE)


def _css(style: str) -> dict[str, str]:
    return {key.lower(): value.strip() for key, value in _CSS_PROP.findall(style or "")}


def _font_size_pt(value: str | None) -> float | None:
    match = _FONT_SIZE.search(value or "")
    if not match:
        return None
    size = float(match.group(1))
    unit = (match.group(2) or "px").lower()
    if unit == "px":
        size *= 0.75
    elif unit in {"em", "rem"}:
        size *= 12
    return max(1.0, min(96.0, size))


def _apply_style(
    current: StructureTextStyle,
    *,
    tag: str,
    attrs: dict[str, str],
) -> StructureTextStyle:
    values = current.model_dump()
    css = _css(attrs.get("style", ""))
    weight = css.get("font-weight", "").lower()
    decoration = css.get("text-decoration", "").lower()
    vertical = css.get("vertical-align", "").lower()

    if tag in {"b", "strong"} or weight == "bold" or (weight.isdigit() and int(weight) >= 600):
        values["bold"] = True
    if tag in {"i", "em"} or css.get("font-style", "").lower() == "italic":
        values["italic"] = True
    if tag == "u" or "underline" in decoration:
        values["underline"] = True
    if tag in {"s", "strike", "del"} or "line-through" in decoration:
        values["strike"] = True
    if tag == "sup" or vertical in {"super", "sup"}:
        values["superscript"] = True
        values["subscript"] = False
    if tag == "sub" or vertical == "sub":
        values["subscript"] = True
        values["superscript"] = False

    size = _font_size_pt(css.get("font-size"))
    if size is not None:
        values["font_size_pt"] = size
    family = css.get("font-family")
    if family:
        values["font_family"] = family.strip("'\"").split(",")[0].strip()
    color = css.get("color")
    if color:
        values["color"] = color
    background = css.get("background-color") or css.get("background")
    if tag == "mark" and not background:
        background = "#ffff00"
    if background:
        values["background_color"] = background
    return StructureTextStyle(**values)


class _RichTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack = [StructureTextStyle()]
        self.href_stack: list[str | None] = [None]
        self.runs: list[StructureTextRun] = []
        self.alignments: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        name = tag.lower()
        attr = {key.lower(): (value or "") for key, value in attrs}
        css = _css(attr.get("style", ""))
        align = attr.get("align") or css.get("text-align")
        if align:
            self.alignments.append(align.lower())
        if name == "br":
            self._append("\n")
            return
        self.stack.append(_apply_style(self.stack[-1], tag=name, attrs=attr))
        self.href_stack.append(attr.get("href") or self.href_stack[-1])

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "br" and len(self.stack) > 1:
            self.stack.pop()
            self.href_stack.pop()

    def handle_data(self, data: str) -> None:
        self._append(data)

    def _append(self, text: str) -> None:
        if not text:
            return
        style = self.stack[-1]
        href = self.href_stack[-1]
        if self.runs and self.runs[-1].style == style and self.runs[-1].href == href:
            self.runs[-1].text += text
        else:
            self.runs.append(StructureTextRun(text=text, style=style.model_copy(), href=href))


def parse_rich_text(value: str | None) -> tuple[list[StructureTextRun], str | None]:
    text = (value or "").strip()
    if not text or "<" not in text:
        return [], None
    parser = _RichTextParser()
    try:
        parser.feed(text)
    except Exception:  # noqa: BLE001
        return [], None
    alignment = parser.alignments[-1] if parser.alignments else None
    return parser.runs, alignment
