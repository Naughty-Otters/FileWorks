"""OCR engine package — strategy registry entrypoints."""

from app.engines.base import ExtractResult, OCREngine, OutputFormat
from app.engines.registry import EngineRegistry, EngineSelectionStrategy, FixedEngineStrategy

__all__ = [
    "ExtractResult",
    "OCREngine",
    "OutputFormat",
    "EngineRegistry",
    "EngineSelectionStrategy",
    "FixedEngineStrategy",
]
