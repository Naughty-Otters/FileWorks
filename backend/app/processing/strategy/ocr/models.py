"""OCR routing models — text vs fast vs deep local chains."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class OcrRoute(str, Enum):
    """Local OCR chain after the text-layer probe (LLM is a reader, not an OCR route)."""

    TEXT = "text"
    FAST = "fast"
    DEEP = "deep"


@dataclass(frozen=True)
class PageOcrAssessment:
    page_number: int
    needs_ocr: bool
    reasons: tuple[str, ...] = ()


@dataclass
class OcrAssessment:
    needs_ocr: bool
    pages: list[PageOcrAssessment] = field(default_factory=list)
    text_layer_majority: bool = False
    source: str = "unknown"

    @property
    def ocr_page_count(self) -> int:
        return sum(1 for page in self.pages if page.needs_ocr)


@dataclass(frozen=True)
class LiteParseAttempt:
    name: str
    ocr_server_url: str | None


@dataclass
class OcrPlan:
    route: OcrRoute
    assessment: OcrAssessment
    liteparse_attempts: tuple[LiteParseAttempt, ...] = ()
    reason: str = ""

    def to_metadata(self) -> dict[str, Any]:
        return {
            "ocr_route": self.route.value,
            "ocr_needs_ocr": self.assessment.needs_ocr,
            "ocr_page_count": self.assessment.ocr_page_count,
            "ocr_text_layer_majority": self.assessment.text_layer_majority,
            "ocr_strategy_reason": self.reason,
            "liteparse_attempts": [attempt.name for attempt in self.liteparse_attempts],
        }
