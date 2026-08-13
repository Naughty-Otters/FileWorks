"""Format export abstractions (Markdown → download formats)."""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.processing.models import ExportArtifact, OutputKind, ReadResult


class FormatExporter(ABC):
    """Converts a read result (or markdown string) into a downloadable artifact."""

    id: str
    label: str
    aliases: tuple[str, ...] = ()

    @abstractmethod
    def can_export(self, source_kind: OutputKind = OutputKind.MARKDOWN) -> bool:
        """Whether this exporter accepts the given source content kind."""

    @abstractmethod
    def export(
        self,
        *,
        markdown: str,
        title: str = "document",
        read_result: ReadResult | None = None,
    ) -> ExportArtifact:
        """Build download bytes from Markdown (default pipeline output)."""

    def matches(self, format_id: str) -> bool:
        key = format_id.strip().lower()
        return key == self.id or key in self.aliases

    def describe(self) -> dict[str, object]:
        return {
            "id": self.id,
            "label": self.label,
            "aliases": list(self.aliases),
        }
