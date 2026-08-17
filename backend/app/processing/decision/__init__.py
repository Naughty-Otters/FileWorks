"""Legacy re-export — use ``app.processing.strategy.reader``."""

from app.processing.strategy.reader import (
    EngineDecisionMaker,
    PriorityFallbackDecisionMaker,
    PriorityFallbackReaderOrdering,
    ReaderOrderingStrategy,
)

__all__ = [
    "EngineDecisionMaker",
    "PriorityFallbackDecisionMaker",
    "PriorityFallbackReaderOrdering",
    "ReaderOrderingStrategy",
]
