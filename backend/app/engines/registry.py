"""Engine registry and selection strategies (server-controlled OCR providers)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any, Callable

from app.core.config import Settings
from app.engines.base import OCREngine
from app.engines.paddle_ocr import PaddleOCREngine
from app.engines.paddle_structure import PaddleStructureEngine
from app.services.options import ENGINE_OPTION_SUPPORT


EngineFactory = Callable[[Settings], OCREngine]


class EngineSelectionStrategy(ABC):
    """Chooses which registered OCR provider id to use (warmup / legacy)."""

    @abstractmethod
    def select(self) -> str:
        """Return the configured engine id."""


class FixedEngineStrategy(EngineSelectionStrategy):
    """Always use the server-configured OCR provider."""

    def __init__(self, engine_id: str) -> None:
        self.engine_id = engine_id.strip().lower()

    def select(self) -> str:
        return self.engine_id


class EngineRegistry:
    """Holds Paddle OCR provider strategies (no cloud Doc AI)."""

    def __init__(
        self,
        settings: Settings,
        selection: EngineSelectionStrategy | None = None,
    ) -> None:
        self.settings = settings
        default = (settings.ocr_engine or "structure").strip().lower()
        if default in {"google", "google_docai", "docai", "documentai"}:
            default = "structure"
        self.selection = selection or FixedEngineStrategy(default)
        self._factories: dict[str, EngineFactory] = {
            PaddleStructureEngine.id: PaddleStructureEngine,
            PaddleOCREngine.id: PaddleOCREngine,
        }
        self._aliases = {
            "paddle": PaddleStructureEngine.id,
            "paddle_structure": PaddleStructureEngine.id,
            "structurev3": PaddleStructureEngine.id,
            "pp-ocr": PaddleOCREngine.id,
            "ppocr": PaddleOCREngine.id,
        }
        self._instances: dict[str, OCREngine] = {}

    def available_ids(self) -> list[str]:
        return sorted(self._factories.keys())

    def resolve_id(self, engine_id: str) -> str:
        key = engine_id.strip().lower()
        return self._aliases.get(key, key)

    def get(self, engine_id: str) -> OCREngine:
        resolved = self.resolve_id(engine_id)
        if resolved not in self._factories:
            known = ", ".join(self.available_ids())
            raise ValueError(f"Unknown OCR engine '{engine_id}'. Known: {known}")
        if resolved not in self._instances:
            self._instances[resolved] = self._factories[resolved](self.settings)
        return self._instances[resolved]

    def select_engine(self) -> OCREngine:
        return self.get(self.selection.select())

    def describe(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        active_id = self.selection.select()
        for engine_id in self.available_ids():
            engine = self.get(engine_id)
            items.append(
                {
                    "id": engine.id,
                    "label": engine.label,
                    "ready": engine.ready,
                    "configured": True,
                    "active": engine.id == active_id,
                    "error": engine.init_error,
                    "option_support": ENGINE_OPTION_SUPPORT.get(engine.id, {}),
                }
            )
        return items
