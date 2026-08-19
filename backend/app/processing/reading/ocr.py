"""OCR reader — PP-OCR first, or PP-StructureV3 first when prefer_structure.

For PDFs whose pages mostly already have a native text layer, skip Paddle
entirely: keep that text and let postprocess embed the document's images.
OCR stays for scanned / image-majority files.
"""

from __future__ import annotations

import logging

from app.core.config import get_settings
from app.processing.models import Capability, DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.reading.base import Reader
from app.processing.reading.provider_adapter import IMAGE_AND_PDF_SUFFIXES, read_with_provider
from app.services.markdown import markdown_looks_flat
from app.services.ocr import get_ocr_service
from app.services.options import ExtractOptions
from app.services.pages import (
    TEXT_MAJORITY_RATIO,
    TEXT_PAGE_MIN_CHARS,
    assemble_page_dicts,
    pdf_majority_has_text,
    pdf_text_layer_stats,
)

logger = logging.getLogger(__name__)

_DEFAULT_ORDER = ("ocr", "structure")
_STRUCTURE_FIRST = ("structure", "ocr")


class OCRReader(Reader):
    """
    Single reading path for OCR backends (Paddle providers).

    Default: PP-OCR, then PP-StructureV3 when OCR fails or returns empty Markdown.
    ``prefer_structure``: Structure first, and flat OCR text can fall through.

    PDFs with a majority text layer skip Paddle and return that text so images
    can be embedded by postprocess instead of being re-read by OCR.
    """

    id = "ocr"
    label = "OCR"
    priority = 50  # After AnyDoc (10)

    def can_process(
        self,
        source: SourceFile,
        options: ExtractOptions | None = None,
    ) -> Capability:
        del options
        from app.processing.pipeline_config import get_pipeline_spec

        blocked = get_pipeline_spec(get_settings()).reader_disabled_reason(self.id)
        if blocked:
            return Capability.no(blocked)
        if source.is_image:
            return Capability.yes("raster image — OCR", confidence=1.0)
        if source.suffix == ".pdf":
            if pdf_majority_has_text(source.path):
                return Capability.yes(
                    "PDF mostly has extractable text — skip OCR, keep text + embed images",
                    confidence=0.85,
                )
            return Capability.yes("PDF OCR / structure fallback", confidence=0.45)
        if source.suffix in IMAGE_AND_PDF_SUFFIXES:
            return Capability.yes(f"OCR can attempt {source.suffix}", confidence=0.5)
        return Capability.no(f"OCR does not handle {source.suffix}")

    def read(
        self,
        source: SourceFile,
        *,
        options: ExtractOptions | None = None,
        preferred_output: OutputKind = OutputKind.MARKDOWN,
    ) -> ReadResult:
        del preferred_output
        if source.suffix == ".pdf" and pdf_majority_has_text(source.path):
            return self._read_pdf_text_layer(source, options=options)

        prefer_structure = bool(options and options.prefer_structure)
        order = _STRUCTURE_FIRST if prefer_structure else _DEFAULT_ORDER
        registry = get_ocr_service().registry
        errors: list[str] = []
        last_empty: ReadResult | None = None
        last_flat: ReadResult | None = None

        for index, provider_id in enumerate(order):
            from app.services.cancel_token import check_cancelled

            check_cancelled(where=f"before OCR provider={provider_id}")
            provider = registry.get(provider_id)
            logger.info("OCRReader trying provider=%s", provider_id)
            try:
                result = read_with_provider(
                    provider=provider,
                    reader_id=self.id,
                    reader_label=provider.label,
                    source=source,
                    options=options,
                )
            except Exception as exc:  # noqa: BLE001
                msg = f"{provider_id}: {exc}"
                logger.warning("OCR provider failed — %s", msg)
                errors.append(msg)
                continue

            markdown = result.markdown() or ""
            has_more = index < len(order) - 1
            if not markdown.strip():
                msg = f"{provider_id}: empty markdown"
                logger.warning("OCR provider produced no text — %s", msg)
                errors.append(msg)
                last_empty = result
                if has_more:
                    continue
                return result
            if prefer_structure and has_more and markdown_looks_flat(markdown):
                msg = f"{provider_id}: flat markdown (prefer_structure)"
                logger.warning("OCR provider structure looks weak — %s", msg)
                errors.append(msg)
                last_flat = result
                continue
            return result

        if last_flat is not None:
            return last_flat
        if last_empty is not None:
            return last_empty

        raise RuntimeError(
            "All OCR providers failed: " + (" | ".join(errors) if errors else "unknown")
        )

    def _read_pdf_text_layer(
        self,
        source: SourceFile,
        *,
        options: ExtractOptions | None = None,
    ) -> ReadResult:
        """Keep the native text layer; postprocess embeds figures into the Markdown."""
        texts, with_text, page_count = pdf_text_layer_stats(source.path)
        logger.info(
            "Skipping OCR for %s: %s/%s pages have a text layer "
            "(threshold %s chars, majority > %.0f%%) — embedding images instead",
            source.filename,
            with_text,
            page_count,
            TEXT_PAGE_MIN_CHARS,
            TEXT_MAJORITY_RATIO * 100,
        )
        pages, assembled_count, joined = assemble_page_dicts(texts, source="pdf-text")
        outputs = [
            DocumentOutput(kind=OutputKind.MARKDOWN, content=joined),
            DocumentOutput(kind=OutputKind.TEXT, content=joined),
            DocumentOutput(
                kind=OutputKind.JSON,
                data={"pages": [page.get("json") for page in pages], "source": "pdf-text"},
            ),
        ]
        return ReadResult(
            engine_id=self.id,
            engine_label="PDF text",
            outputs=outputs,
            pages=pages,
            page_count=assembled_count or page_count or 1,
            metadata={
                "provider": "pdf-text",
                "skipped_ocr": True,
                "text_pages": with_text,
                "source_page_count": page_count,
                "text_page_min_chars": TEXT_PAGE_MIN_CHARS,
            },
            options=options.to_dict() if options else None,
        )
