"""FillStage — ensure structure blocks carry content (no re-recognition)."""

from __future__ import annotations

from app.processing.structure.html_table import parse_html_table
from app.processing.structure.schema import StructureDocument


_IGNORE = {
    "number",
    "footnote",
    "header",
    "header_image",
    "footer",
    "footer_image",
    "aside_text",
    "formula_number",
}


def fill_structure(doc: StructureDocument) -> StructureDocument:
    """Mutate-in-copy: parse tables, normalize formulas, drop empty ignored labels."""
    filled = []
    for block in doc.blocks:
        label = (block.label or "text").lower().strip()
        text = block.text or ""
        table = block.table
        formula = block.formula
        image_ref = block.image_ref

        if label == "table":
            if table is None and "<table" in text.lower():
                table = parse_html_table(text)
            if table and not text.strip() and table.cells:
                text = table.html or _table_plain(table)

        if label == "formula":
            body = (formula or text).strip()
            if body:
                formula = body
                if not body.startswith("$"):
                    text = f"$$\n{body}\n$$"
                else:
                    text = body

        if label in {"image", "chart", "seal"} and not image_ref:
            if text.startswith("![") or text.startswith("<img") or "data:image" in text:
                image_ref = text.strip()

        if label in _IGNORE and not text.strip():
            continue

        filled.append(
            block.model_copy(
                update={
                    "text": text,
                    "table": table,
                    "formula": formula,
                    "image_ref": image_ref,
                }
            )
        )

    return doc.model_copy(update={"blocks": filled})


def _table_plain(table) -> str:
    lines: list[str] = []
    for cell in table.cells:
        if cell.text:
            lines.append(cell.text)
    return "\n".join(lines)
