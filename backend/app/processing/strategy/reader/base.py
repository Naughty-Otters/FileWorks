"""Reader ordering strategy interface."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence

from app.processing.models import Capability, SourceFile
from app.processing.reading.base import Reader
from app.services.options import ExtractOptions


class ReaderOrderingStrategy(ABC):
    """Chooses which reader(s) should handle a source file and in what order."""

    @abstractmethod
    def decide(
        self,
        source: SourceFile,
        readers: Sequence[Reader],
        options: ExtractOptions | None = None,
    ) -> list[tuple[Reader, Capability]]:
        """
        Return ordered candidate readers (best first) with capability notes.
        Empty list means no reader can handle the file.
        """


# Legacy alias used by the pipeline facade.
EngineDecisionMaker = ReaderOrderingStrategy
