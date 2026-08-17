"""OCR output quality heuristics."""

from __future__ import annotations

from typing import Any


def markdown_is_weak(markdown: str, *, min_chars: int = 40) -> bool:
    stripped = (markdown or "").strip()
    if len(stripped) < min_chars:
        return True
    alnum = sum(1 for c in stripped if c.isalnum())
    return alnum < max(12, min_chars // 2)


def ocr_results_are_weak(results: list[dict[str, Any]], *, min_chars: int = 12) -> bool:
    text = " ".join(str(item.get("text") or "").strip() for item in results).strip()
    return markdown_is_weak(text, min_chars=min_chars)
