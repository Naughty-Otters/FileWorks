"""OCR routing strategy interface."""

from __future__ import annotations

from abc import ABC, abstractmethod

from app.core.config import Settings
from app.processing.models import SourceFile
from app.processing.strategy.ocr.models import OcrPlan
from app.services.options import ExtractOptions


class OcrRoutingStrategy(ABC):
    """Plans local OCR chains (text / fast / deep) for LiteParse and HTTP callbacks."""

    @abstractmethod
    def plan(
        self,
        source: SourceFile,
        options: ExtractOptions | None = None,
        *,
        settings: Settings | None = None,
    ) -> OcrPlan:
        """Return an OCR plan for the given source."""
