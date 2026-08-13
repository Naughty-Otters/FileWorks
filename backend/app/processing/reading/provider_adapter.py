"""Shared adapter: OCR provider ExtractResult/dict → ReadResult."""

from __future__ import annotations

from typing import Any

from app.engines.base import ExtractResult, OCREngine
from app.processing.models import DocumentOutput, OutputKind, ReadResult, SourceFile
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions


def read_with_provider(
    *,
    provider: OCREngine,
    reader_id: str,
    reader_label: str,
    source: SourceFile,
    options: ExtractOptions | None = None,
) -> ReadResult:
    opts = options or DEFAULT_EXTRACT_OPTIONS
    provider.ensure_ready()
    extracted: ExtractResult = provider.extract(
        source.path,
        output_format="both",
        options=opts,
        mime_type=source.mime_type,
    )
    raw: dict[str, Any] = extracted.to_dict()
    markdown = str(raw.get("markdown") or "")
    json_data = raw.get("json")
    pages = list(raw.get("pages") or [])
    regions = list(raw.get("regions") or [])
    image_size = raw.get("image_size")

    outputs = [
        DocumentOutput(kind=OutputKind.MARKDOWN, content=markdown),
        DocumentOutput(kind=OutputKind.JSON, data=json_data),
    ]
    if markdown:
        outputs.append(DocumentOutput(kind=OutputKind.TEXT, content=markdown))

    return ReadResult(
        engine_id=reader_id,
        engine_label=str(raw.get("engine") or reader_label),
        outputs=outputs,
        pages=pages,
        regions=regions,
        image_size=image_size if isinstance(image_size, dict) else None,
        page_count=int(raw.get("page_count") or max(len(pages), 1)),
        metadata={"provider": provider.id},
        options=opts.to_dict(),
    )


IMAGE_AND_PDF_SUFFIXES = frozenset(
    {
        ".png",
        ".jpg",
        ".jpeg",
        ".bmp",
        ".tif",
        ".tiff",
        ".webp",
        ".pdf",
    }
)
