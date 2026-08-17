"""Priority-based reader ordering with AI / LLM boost rules."""

from __future__ import annotations

import logging
from collections.abc import Sequence

from app.core.config import get_settings
from app.processing.models import Capability, SourceFile
from app.processing.reading.base import Reader
from app.processing.strategy.reader.base import ReaderOrderingStrategy
from app.processing.strategy.reader.llm import llm_vision_ready
from app.services.options import ExtractOptions

logger = logging.getLogger(__name__)


class PriorityFallbackReaderOrdering(ReaderOrderingStrategy):
    """
    Select every reader that reports ``can_process.supported``,
    ordered by effective priority ascending, then confidence descending.

    LLM ordering:
      - ``use_ai`` on + vision LLM ready → ``LLM_PRIORITY`` (default 30, before LiteParse/OCR)
      - otherwise → ``LLM_PRIORITY_FALLBACK`` (default 95, last resort)
    """

    def decide(
        self,
        source: SourceFile,
        readers: Sequence[Reader],
        options: ExtractOptions | None = None,
    ) -> list[tuple[Reader, Capability]]:
        settings = get_settings()
        capable: list[tuple[Reader, Capability]] = []
        for reader in readers:
            capability = reader.can_process(source, options)
            if capability.supported:
                capable.append((reader, capability))
            else:
                logger.info("Skipping reader=%s reason=%s", reader.id, capability.reason)
        capable.sort(
            key=lambda item: (
                _effective_priority(item[0], source, options, settings),
                -item[1].confidence,
            )
        )
        return capable


# Legacy alias.
PriorityFallbackDecisionMaker = PriorityFallbackReaderOrdering


def _effective_priority(
    reader: Reader,
    source: SourceFile,
    options: ExtractOptions | None,
    settings,
) -> int:
    if reader.id == "llm":
        if options is not None and options.use_ai and llm_vision_ready(settings):
            return int(settings.llm_priority)
        return int(settings.llm_priority_fallback)

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
