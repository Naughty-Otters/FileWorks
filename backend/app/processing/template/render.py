from __future__ import annotations

from html import escape
from io import BytesIO
from typing import Any

from app.processing.template.schema import DesignDocument, DesignNode


def _style(node: DesignNode) -> str:
    style = node.style
    pairs: list[tuple[str, Any]] = [
        ("position", "absolute"),
        ("left", f"{node.x}px"),
        ("top", f"{node.y}px"),
        ("width", f"{node.w}px"),
        ("height", f"{node.h}px"),
        ("font-family", style.font_family),
        ("font-size", f"{style.font_size}px" if style.font_size else None),
        ("font-weight", "bold" if style.bold else None),
        ("font-style", "italic" if style.italic else None),
        ("text-decoration", "underline" if style.underline else None),
        ("color", style.color),
        ("background", style.background_color),
        ("text-align", style.align),
        (
            "border",
            f"{style.border_width}px {style.border_style} {style.border_color}",
        ),
        ("object-fit", node.object_fit if node.type == "image" else None),
        ("box-sizing", "border-box"),
        ("overflow-wrap", "anywhere"),
    ]
    return ";".join(f"{key}:{value}" for key, value in pairs if value is not None)


def _html_node(node: DesignNode) -> str:
    attrs = f'id="{escape(node.id, quote=True)}" style="{escape(_style(node), quote=True)}"'
    if node.type == "image":
        if not node.image_src:
            return ""
        src = node.image_src.strip()
        if not src.startswith(("https://", "http://", "data:image/", "/")):
            return ""
        return (
            f'<img {attrs} src="{escape(src, quote=True)}" '
            f'alt="{escape(node.label, quote=True)}">'
        )
    children = "".join(_html_node(child) for child in node.children)
    text = "" if node.type == "box" else escape(node.label).replace("\n", "<br>")
    if node.type == "heading":
        tag = f"h{node.level}"
    elif node.type == "paragraph":
        tag = "p"
    else:
        tag = "div"
    return f"<{tag} {attrs}>{text}{children}</{tag}>"


def render_html(document: DesignDocument, *, title: str = "Document") -> str:
    page = document.page
    nodes = _html_node(document.root)
    rendered_page = (
        f'<section class="page" data-page="1" style="width:{page.w}px;height:{page.h}px">'
        f"{nodes}</section>"
    )
    return (
        "<!doctype html><html><head><meta charset=\"utf-8\">"
        f"<title>{escape(title)}</title><style>"
        "html,body{margin:0;background:#eee}.page{position:relative;margin:16px auto;"
        "overflow:hidden;box-shadow:0 1px 5px #999}@media print{body{background:white}"
        ".page{margin:0;box-shadow:none;break-after:page}}</style></head><body>"
        + rendered_page
        + "</body></html>"
    )


def render_docx(document: DesignDocument, *, title: str = "Document") -> bytes:
    """Editable, intentionally linear DOCX representation of the design tree."""
    from docx import Document

    output = Document()
    output.core_properties.title = title

    def add(nodes: list[DesignNode], depth: int = 0) -> None:
        for node in nodes:
            if node.type == "heading":
                output.add_heading(node.label, level=min(node.level, 9))
            elif node.type == "paragraph":
                output.add_paragraph(node.label)
            elif node.type == "image":
                output.add_paragraph(node.alt or node.label or f"[Image: {node.image_src or ''}]")
            add(node.children, depth + 1)

    add([document.root])
    buffer = BytesIO()
    output.save(buffer)
    return buffer.getvalue()
