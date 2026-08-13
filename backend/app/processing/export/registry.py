"""Exporter registry."""

from __future__ import annotations

from app.processing.export.base import FormatExporter
from app.processing.export.formats import HtmlExporter, JsonExporter, MarkdownExporter, TextExporter


class ExportRegistry:
    def __init__(self, exporters: list[FormatExporter] | None = None) -> None:
        self._exporters = list(exporters) if exporters is not None else self.default_exporters()

    @staticmethod
    def default_exporters() -> list[FormatExporter]:
        return [
            MarkdownExporter(),
            TextExporter(),
            HtmlExporter(),
            JsonExporter(),
        ]

    def all(self) -> list[FormatExporter]:
        return list(self._exporters)

    def resolve(self, format_id: str) -> FormatExporter:
        for exporter in self._exporters:
            if exporter.matches(format_id):
                return exporter
        known = ", ".join(e.id for e in self._exporters)
        raise ValueError(f"Unsupported export format '{format_id}'. Supported: {known}")

    def describe(self) -> list[dict[str, object]]:
        return [e.describe() for e in self._exporters]

    def register(self, exporter: FormatExporter) -> None:
        self._exporters = [e for e in self._exporters if e.id != exporter.id]
        self._exporters.append(exporter)
