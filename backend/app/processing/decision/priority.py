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
    """Keep AnyDoc available; only postpone it for PDFs when prefer_structure is on."""
    if (
        options is not None
        and options.prefer_structure is True
        and reader.id == "anydoc"
        and source.suffix == ".pdf"
    ):
        return 55
    return reader.priority
