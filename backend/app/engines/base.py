"""OCR engine strategy interface and shared extract result shape."""

from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Literal

from pydantic import Field
from pydantic.dataclasses import dataclass

from app.services.options import ExtractOptions

OutputFormat = Literal["markdown", "json", "both"]


@dataclass
class ExtractResult:
    """Normalized extraction payload returned to the API layer."""

    engine: str
    page_count: int
    pages: list[dict[str, Any]] = Field(default_factory=list)
    markdown: str | None = None
    json_data: Any | None = None
    regions: list[dict[str, Any]] = Field(default_factory=list)
    image_size: dict[str, float] | None = None
    options: dict[str, Any] | None = None
    provider: str | None = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "engine": self.engine,
            "page_count": self.page_count,
            "pages": self.pages,
            "regions": self.regions,
            "image_size": self.image_size,
        }
        if self.markdown is not None:
            payload["markdown"] = self.markdown
        if self.json_data is not None:
            payload["json"] = self.json_data
        if self.options is not None:
            payload["options"] = self.options
        if self.provider is not None:
            payload["provider"] = self.provider
        return payload


class OCREngine(ABC):
    """Strategy interface for a concrete OCR / document-parse backend."""

    id: str
    label: str

    @abstractmethod
    def ensure_ready(self) -> None:
        """Eagerly initialize remote clients / local models."""

    @property
    @abstractmethod
    def ready(self) -> bool:
        """Whether the engine is initialized and usable."""

    @property
    def init_error(self) -> str | None:
        return None

    @abstractmethod
    def extract(
        self,
        file_path: Path,
        *,
        output_format: OutputFormat = "both",
        options: ExtractOptions | None = None,
        mime_type: str | None = None,
    ) -> ExtractResult:
        """Run extraction and return a normalized result."""

    def supports_options(self) -> bool:
        """Whether ExtractOptions meaningfully affect this engine."""
        return False
