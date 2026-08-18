"""Docling reader — layout-aware PDF / image conversion when prefer_structure is on."""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import get_settings
from app.processing.models import Capability, DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.reading.base import Reader
from app.processing.reading.provider_adapter import IMAGE_AND_PDF_SUFFIXES
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions
from app.services.pages import assemble_page_dicts, docling_page_markdowns, pdf_page_count

logger = logging.getLogger(__name__)

_DOCLING_IMPORT_ERROR: str | None = None


def docling_is_available() -> bool:
    global _DOCLING_IMPORT_ERROR
    try:
        from app.core.venvpath import import_unshadowed

        import_unshadowed("docling")
        from docling.document_converter import DocumentConverter  # noqa: F401

        _DOCLING_IMPORT_ERROR = None
        return True
    except Exception as exc:  # noqa: BLE001
        _DOCLING_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
        logger.warning("docling unavailable: %s", _DOCLING_IMPORT_ERROR)
        return False


def _import_converter() -> Any:
    from app.core.venvpath import import_unshadowed

    import_unshadowed("docling")
    from docling.document_converter import DocumentConverter

    return DocumentConverter


def _converter_kwargs() -> dict[str, Any]:
    """Point Docling at baked weights so Lambda (no NAT) never hits HuggingFace."""
    artifacts = get_settings().docling_artifacts_path
    if not artifacts:
        return {}
    try:
        from app.core.venvpath import import_unshadowed

        import_unshadowed("docling")
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import PdfFormatOption
    except ImportError:
        return {}
    pipeline_options = PdfPipelineOptions(artifacts_path=artifacts)
    format_options: dict[Any, Any] = {
        InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
    }
    try:
        from docling.document_converter import ImageFormatOption

        format_options[InputFormat.IMAGE] = ImageFormatOption(pipeline_options=pipeline_options)
    except ImportError:
        pass
    return {"format_options": format_options}


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
            detail = _DOCLING_IMPORT_ERROR or "import failed"
            return Capability.no(f"docling extra is not installed ({detail})")
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
        converter = converter_cls(**_converter_kwargs())
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
