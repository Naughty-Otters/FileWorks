"""Reader package."""

from app.processing.reading.anydoc import AnyDocReader
from app.processing.reading.base import Reader
from app.processing.reading.llm import LLMReader
from app.processing.reading.ocr import OCRReader
from app.processing.reading.registry import ReaderRegistry
from app.processing.reading.text import TextReader

__all__ = [
    "AnyDocReader",
    "LLMReader",
    "OCRReader",
    "Reader",
    "ReaderRegistry",
    "TextReader",
]
