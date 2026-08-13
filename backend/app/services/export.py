"""Backward-compatible facade over ``DocumentPipeline`` exporters."""

from __future__ import annotations

from app.processing.pipeline import get_document_pipeline


def export_markdown(
    markdown: str,
    *,
    fmt: str,
    title: str = "document",
) -> tuple[bytes, str, str]:
    """Return (bytes, media_type, filename_extension)."""
    artifact = get_document_pipeline().export(markdown, format_id=fmt, title=title)
    return artifact.data, artifact.media_type, artifact.extension
