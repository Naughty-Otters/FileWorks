"""Backward-compatible facade over ``DocumentPipeline`` exporters."""

from __future__ import annotations

from typing import Any

from app.processing.pipeline import get_document_pipeline
from app.processing.structure.schema import StructureDocument


def export_markdown(
    markdown: str,
    *,
    fmt: str,
    title: str = "document",
    source_bytes: bytes | None = None,
    source_suffix: str | None = None,
    structure: StructureDocument | dict[str, Any] | None = None,
) -> tuple[bytes, str, str]:
    """Return (bytes, media_type, filename_extension)."""
    parsed: StructureDocument | None = None
    if isinstance(structure, StructureDocument):
        parsed = structure
    elif isinstance(structure, dict):
        try:
            parsed = StructureDocument.model_validate(structure)
        except Exception:  # noqa: BLE001
            parsed = None
    artifact = get_document_pipeline().export(
        markdown,
        format_id=fmt,
        title=title,
        source_bytes=source_bytes,
        source_suffix=source_suffix,
        structure=parsed,
    )
    return artifact.data, artifact.media_type, artifact.extension
