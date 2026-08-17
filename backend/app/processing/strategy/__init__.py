"""Document processing strategies — reader ordering and OCR routing."""

from app.processing.strategy.ocr import (
    DefaultOcrRoutingStrategy,
    OcrRoutingStrategy,
)
from app.processing.strategy.reader import (
    PriorityFallbackDecisionMaker,
    PriorityFallbackReaderOrdering,
    ReaderOrderingStrategy,
)

__all__ = [
    "DefaultOcrRoutingStrategy",
    "OcrRoutingStrategy",
    "PriorityFallbackDecisionMaker",
    "PriorityFallbackReaderOrdering",
    "ReaderOrderingStrategy",
]
