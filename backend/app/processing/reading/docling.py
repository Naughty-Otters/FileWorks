"""Docling reader — layout-aware PDF / image conversion when prefer_structure is on."""

from __future__ import annotations

import logging
from typing import Any

from app.processing.models import Capability, DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.reading.base import Reader
from app.processing.reading.provider_adapter import IMAGE_AND_PDF_SUFFIXES
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions
from app.services.pages import assemble_page_dicts, docling_page_markdowns, pdf_page_count

logger = logging.getLogger(__name__)


def docling_is_available() -> bool:
    try:
        from docling.document_converter import DocumentConverter  # noqa: F401

        return True
    except Exception:  # noqa: BLE001
        return False


def _import_converter() -> Any:
    from docling.document_converter import DocumentConverter

    return DocumentConverter


class DoclingReader(Reader):
    """
    Optional IBM Docling path for PDFs and raster images.

    Inactive unless ``prefer_structure`` is on and the ``docling`` extra is installed.
    Office files stay on AnyDoc.
    """

    id = "docling"
    label = "Docling"
    priority = 8  # Before AnyDoc (10) when eligible

    def can_process(
        self,
        source: SourceFile,
        options: ExtractOptions | None = None,
    ) -> Capability:
        if options is None or not options.prefer_structure:
            return Capability.no("Prefer structure is off")
        if not docling_is_available():
            return Capability.no("docling extra is not installed")
        if source.is_image:
            return Capability.yes("raster image — Docling", confidence=0.9)
        if source.suffix == ".pdf":
            return Capability.yes("PDF — Docling layout", confidence=0.85)
        if source.suffix in IMAGE_AND_PDF_SUFFIXES:
            return Capability.yes(f"Docling can attempt {source.suffix}", confidence=0.6)
        return Capability.no("Docling is for PDF and images; office stays on AnyDoc")

    def read(
        self,
        source: SourceFile,
        *,
        options: ExtractOptions | None = None,
        preferred_output: OutputKind = OutputKind.MARKDOWN,
    ) -> ReadResult:
        del preferred_output
        opts = options or DEFAULT_EXTRACT_OPTIONS
        converter_cls = _import_converter()
        converter = converter_cls()
        logger.info("Docling converting %s", source.filename)
        converted = converter.convert(str(source.path))
        document = getattr(converted, "document", None)
        if document is None:
            raise RuntimeError("Docling returned no document")
        markdowns = docling_page_markdowns(document)
        extra = {"format": source.suffix}
        pages, page_count, markdown = assemble_page_dicts(markdowns, source=self.id, extra=extra)
        source_pages = pdf_page_count(source.path) if source.suffix == ".pdf" else page_count
        page_json = {"source": self.id, "pages": [page["json"] for page in pages], **extra}
        if page_count == 1:
            page_json = pages[0]["json"] if pages else {"source": self.id, "text": markdown, **extra}
        return ReadResult(
            engine_id=self.id,
            engine_label=self.label,
            outputs=[
                DocumentOutput(kind=OutputKind.MARKDOWN, content=markdown),
                DocumentOutput(kind=OutputKind.JSON, data=page_json),
            ],
            pages=pages,
            page_count=page_count,
            metadata={"format": source.suffix, "source_page_count": source_pages or page_count},
            options=opts.to_dict(),
        )

    def describe(self) -> dict[str, object]:
        payload = super().describe()
        payload["configured"] = docling_is_available()
        return payload
