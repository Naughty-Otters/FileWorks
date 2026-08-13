"""OCR reader — PP-OCR first, then PP-StructureV3 fallback."""

from __future__ import annotations

import logging

from app.processing.models import Capability, OutputKind, ReadResult, SourceFile
from app.processing.reading.base import Reader
from app.processing.reading.provider_adapter import IMAGE_AND_PDF_SUFFIXES, read_with_provider
from app.services.ocr import get_ocr_service
from app.services.options import ExtractOptions

logger = logging.getLogger(__name__)

# Provider try order inside this reader (not separate Readers).
_PROVIDER_ORDER = ("ocr", "structure")


class OCRReader(Reader):
    """
    Single reading path for OCR backends (Paddle providers).

    Tries PP-OCR, then PP-StructureV3 when OCR fails or returns empty Markdown.
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
        if source.is_image:
            return Capability.yes("raster image — OCR", confidence=1.0)
        if source.suffix == ".pdf":
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
        registry = get_ocr_service().registry
        errors: list[str] = []
        last_empty: ReadResult | None = None

        for index, provider_id in enumerate(_PROVIDER_ORDER):
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

            if not (result.markdown() or "").strip():
                msg = f"{provider_id}: empty markdown"
                logger.warning("OCR provider produced no text — %s", msg)
                errors.append(msg)
                last_empty = result
                if index < len(_PROVIDER_ORDER) - 1:
                    continue
            return result

        if last_empty is not None:
            return last_empty

        raise RuntimeError(
            "All OCR providers failed: " + (" | ".join(errors) if errors else "unknown")
        )
