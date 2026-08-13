"""Backward-compatible facade over ``DocumentPipeline`` reading."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.engines.base import OutputFormat
from app.processing.pipeline import get_document_pipeline
from app.processing.reading.anydoc import anydoc_is_available
from app.services.options import ExtractOptions

# Re-export for existing callers / health checks
anydoc_available = anydoc_is_available


def convert_document(
    file_path: Path,
    *,
    output_format: OutputFormat = "both",
    options: ExtractOptions | None = None,
    mime_type: str | None = None,
    filename: str | None = None,
) -> dict[str, Any]:
    """Process a file through the modular reading pipeline."""
    pipeline = get_document_pipeline()
    return pipeline.process(
        file_path,
        filename=filename,
        mime_type=mime_type,
        options=options,
        api_output_format=output_format,
    )
