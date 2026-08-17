"""Legacy re-export — use ``app.processing.strategy.reader``."""

from app.processing.strategy.reader.priority import (
    PriorityFallbackDecisionMaker,
    PriorityFallbackReaderOrdering,
)

__all__ = ["PriorityFallbackDecisionMaker", "PriorityFallbackReaderOrdering"]
