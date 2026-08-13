"""Reader decision strategies."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence

from app.processing.models import Capability, SourceFile
from app.processing.reading.base import Reader
from app.services.options import ExtractOptions


class EngineDecisionMaker(ABC):
    """Chooses which reader(s) should handle a source file."""

    @abstractmethod
    def decide(
        self,
        source: SourceFile,
        readers: Sequence[Reader],
        options: ExtractOptions | None = None,
    ) -> list[tuple[Reader, Capability]]:
        """
        Return ordered candidate readers (best first) with their capability notes.
        Empty list means no reader can handle the file.
        """
