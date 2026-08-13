"""Reader abstractions for document intake."""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.processing.models import Capability, OutputKind, ReadResult, SourceFile
from app.services.options import ExtractOptions


class Reader(ABC):
    """
    Strategy that can read a source file into typed document outputs.

    Implementations must:
    - declare whether they can process a given file via ``can_process``
    - produce at least one ``DocumentOutput`` (default kind: Markdown)
    """

    id: str
    label: str
    # Lower number = higher preference when multiple readers can process.
    priority: int = 100

    @abstractmethod
    def can_process(
        self,
        source: SourceFile,
        options: ExtractOptions | None = None,
    ) -> Capability:
        """Return whether this reader is able to handle the source file."""

    @abstractmethod
    def read(
        self,
        source: SourceFile,
        *,
        options: ExtractOptions | None = None,
        preferred_output: OutputKind = OutputKind.MARKDOWN,
    ) -> ReadResult:
        """Extract content. Raises on hard failure (caller may try next reader)."""

    def describe(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "priority": self.priority,
            "kind": "reader",
        }
