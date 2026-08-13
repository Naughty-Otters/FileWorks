"""Shared helpers for OCR engine strategies."""

from __future__ import annotations

from typing import Any


def json_safe(value: Any) -> Any:
    """Convert numpy / nested objects into JSON-serializable values."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if hasattr(value, "tolist"):
        try:
            return value.tolist()
        except Exception:  # noqa: BLE001
            pass
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:  # noqa: BLE001
            pass
    return str(value)


def collect_texts(payload: Any) -> list[str]:
    texts: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                if key in {"rec_texts", "texts"} and isinstance(value, list):
                    for item in value:
                        if isinstance(item, str) and item.strip():
                            texts.append(item.strip())
                elif key in {"text", "rec_text"} and isinstance(value, str) and value.strip():
                    texts.append(value.strip())
                else:
                    walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return texts


def mime_from_path(path: str, fallback: str | None = None) -> str:
    lower = path.lower()
    if lower.endswith(".pdf"):
        return "application/pdf"
    if lower.endswith((".png",)):
        return "image/png"
    if lower.endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if lower.endswith((".tif", ".tiff")):
        return "image/tiff"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".bmp"):
        return "image/bmp"
    return fallback or "application/octet-stream"
