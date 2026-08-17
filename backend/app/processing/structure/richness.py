"""Decide whether the structure IR is a safe basis for an export.

The recognition engines emit two parallel views of a page: their own markdown
(often carrying real tables, images and inline markup) and a layout parse whose
``block_content`` is frequently plain text. Rebuilding an export from the IR is
only an improvement when the IR kept every rich feature the markdown had.
"""

from __future__ import annotations

import re

from app.processing.structure.project import project_markdown
from app.processing.structure.schema import StructureDocument

_TABLE = re.compile(r"<table|^\s*\|.*\|", re.IGNORECASE | re.MULTILINE)
_IMAGE = re.compile(r"!\[|<img", re.IGNORECASE)
_EMPHASIS = re.compile(r"\*\*|<b\b|<strong\b|<em\b|<i\b|<span\b|<u\b|<mark\b", re.IGNORECASE)
_FORMULA = re.compile(r"\$\$|\\\(|\\\[|<pre", re.IGNORECASE)
_ALNUM = re.compile(r"[^0-9a-z\u00c0-\uffff]+", re.IGNORECASE)

_FEATURES = (_TABLE, _IMAGE, _EMPHASIS, _FORMULA)

# Structure may drop page furniture (headers, footers, page numbers), so allow a
# small shortfall before treating the projection as lossy.
_TEXT_RETENTION = 0.9


def _density(text: str) -> int:
    return len(_ALNUM.sub("", text or ""))


def structure_is_richer(structure: StructureDocument | None, markdown: str | None) -> bool:
    """True when exporting from ``structure`` will not lose engine markdown detail."""
    if structure is None or not structure.blocks:
        return False
    if not structure.meta.get("native_structure", True):
        return False

    engine = markdown or ""
    if not engine.strip():
        return True

    projected = project_markdown(structure)
    for feature in _FEATURES:
        if feature.search(engine) and not feature.search(projected):
            return False
    return _density(projected) >= _density(engine) * _TEXT_RETENTION
