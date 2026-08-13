"""Priority-based decision maker with fallback ordering."""

from __future__ import annotations

from collections.abc import Sequence

from app.processing.decision.base import EngineDecisionMaker
from app.processing.models import Capability, SourceFile
from app.processing.reading.base import Reader
from app.services.options import ExtractOptions


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
        capable.sort(key=lambda item: (item[0].priority, -item[1].confidence))
        return capable
