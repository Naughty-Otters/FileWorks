"""Priority-based decision maker with fallback ordering."""

from __future__ import annotations

import logging
from collections.abc import Sequence

from app.processing.decision.base import EngineDecisionMaker
from app.processing.models import Capability, SourceFile
from app.processing.reading.base import Reader
from app.services.options import ExtractOptions

logger = logging.getLogger(__name__)


class PriorityFallbackDecisionMaker(EngineDecisionMaker):
    """
    Select every reader that reports ``can_process.supported``,
    ordered by ``priority`` ascending, then by confidence descending.

    The pipeline tries candidates in order until one ``read()`` succeeds.
    """

    def decide(
        self,
        source: SourceFile,
        readers: Sequence[Reader],
        options: ExtractOptions | None = None,
    ) -> list[tuple[Reader, Capability]]:
        capable: list[tuple[Reader, Capability]] = []
        for reader in readers:
            capability = reader.can_process(source, options)
            if capability.supported:
                capable.append((reader, capability))
            else:
                logger.info("Skipping reader=%s reason=%s", reader.id, capability.reason)
        capable.sort(key=lambda item: (_effective_priority(item[0], source, options), -item[1].confidence))
        return capable


def _effective_priority(
    reader: Reader,
    source: SourceFile,
    options: ExtractOptions | None,
) -> int:
    """Keep AnyDoc available; only postpone it for PDFs when prefer_structure is on.

    PDFs carrying their own text layer are exempt: the OCR reader returns that
    layer verbatim, with no headings or tables, so demoting AnyDoc there would
    trade the structured parse for the flattest output in the stack.
    """
    if (
        options is not None
        and options.prefer_structure is True
        and reader.id == "anydoc"
        and source.suffix == ".pdf"
        and not _has_pdf_text_layer(source)
    ):
        return 55
    return reader.priority


def _has_pdf_text_layer(source: SourceFile) -> bool:
    from app.services.pages import pdf_has_text_layer_majority

    try:
        return pdf_has_text_layer_majority(source.path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Text-layer probe failed for %s (%s); assuming scanned", source.filename, exc)
        return False
