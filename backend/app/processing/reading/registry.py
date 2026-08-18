"""Registry of document readers."""

from __future__ import annotations

from app.processing.reading.anydoc import AnyDocReader
from app.processing.reading.base import Reader
from app.processing.reading.docling_reader import DoclingReader
from app.processing.reading.liteparse_reader import LiteParseReader
from app.processing.reading.llm import LLMReader
from app.processing.reading.ocr import OCRReader
from app.processing.reading.text import TextReader


class ReaderRegistry:
    def __init__(self, readers: list[Reader] | None = None) -> None:
        self._readers = list(readers) if readers is not None else self.default_readers()
        self._readers.sort(key=lambda r: r.priority)

    @staticmethod
    def default_readers() -> list[Reader]:
        # Priority: Text → Docling → AnyDoc → LLM (use_ai) → LiteParse → OCR → LLM (fallback)
        return [
            TextReader(),
            DoclingReader(),
            AnyDocReader(),
            LLMReader(),
            LiteParseReader(),
            OCRReader(),
        ]

    def all(self) -> list[Reader]:
        return list(self._readers)

    def get(self, reader_id: str) -> Reader:
        for reader in self._readers:
            if reader.id == reader_id:
                return reader
        known = ", ".join(r.id for r in self._readers)
        raise KeyError(f"Unknown reader '{reader_id}'. Known: {known}")

    def describe(self) -> list[dict[str, object]]:
        return [reader.describe() for reader in self._readers]

    def register(self, reader: Reader) -> None:
        self._readers = [r for r in self._readers if r.id != reader.id]
        self._readers.append(reader)
        self._readers.sort(key=lambda r: r.priority)
