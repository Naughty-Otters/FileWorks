"""Plain text / Markdown reader — passthrough into Markdown."""

from __future__ import annotations

from pathlib import Path

from app.processing.models import Capability, DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.reading.base import Reader
from app.services.options import ExtractOptions

TEXT_SUFFIXES = frozenset({".txt", ".md", ".markdown"})
TEXT_MIME_TYPES = frozenset(
    {
        "text/plain",
        "text/markdown",
        "text/x-markdown",
        "text/md",
    }
)


def _read_text(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-8"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1")


class TextReader(Reader):
    """Native .txt / .md intake. No OCR or vision model required."""

    id = "text"
    label = "Text"
    priority = 5  # Before AnyDoc — these files are already Markdown/text

    def can_process(
        self,
        source: SourceFile,
        options: ExtractOptions | None = None,
    ) -> Capability:
        del options
        if source.suffix in TEXT_SUFFIXES:
            return Capability.yes(f"passthrough {source.suffix}", confidence=1.0)
        mime = (source.mime_type or "").split(";", 1)[0].strip().lower()
        if mime in TEXT_MIME_TYPES:
            return Capability.yes(f"passthrough {mime}", confidence=0.9)
        return Capability.no(f"Text reader does not handle {source.suffix}")

    def read(
        self,
        source: SourceFile,
        *,
        options: ExtractOptions | None = None,
        preferred_output: OutputKind = OutputKind.MARKDOWN,
    ) -> ReadResult:
        del options, preferred_output
        text = _read_text(source.path)
        outputs = [
            DocumentOutput(kind=OutputKind.MARKDOWN, content=text),
            DocumentOutput(kind=OutputKind.TEXT, content=text),
        ]
        return ReadResult(
            engine_id=self.id,
            engine_label=self.label,
            outputs=outputs,
            metadata={"source_suffix": source.suffix, "passthrough": True},
        )
