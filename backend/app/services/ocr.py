"""Client-facing OCR provider facade (Paddle Structure / PP-OCR).

Used for warmup/health and as a shared registry for readers.
Upload routing prefers readers: AnyDoc → OCR (PP-OCR → Structure).
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings
from app.engines.base import OutputFormat
from app.engines.registry import EngineRegistry, FixedEngineStrategy
from app.engines.utils import json_safe
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions

logger = logging.getLogger(__name__)


class OCRService:
    """Stable API for extract / health / warmup regardless of backend engine."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        default_id = (self.settings.ocr_engine or "structure").strip().lower()
        self.registry = EngineRegistry(
            self.settings,
            selection=FixedEngineStrategy(default_id),
        )
        self._last_engine_id: str | None = None
        self._last_error: str | None = None

    @property
    def ready(self) -> bool:
        try:
            return self.registry.select_engine().ready
        except Exception:  # noqa: BLE001
            return False

    @property
    def mode(self) -> str | None:
        try:
            return self.registry.selection.select()
        except Exception:  # noqa: BLE001
            return self._last_engine_id

    @property
    def init_error(self) -> str | None:
        if self._last_error:
            return self._last_error
        try:
            return self.registry.select_engine().init_error
        except Exception as exc:  # noqa: BLE001
            return str(exc)

    def list_engines(self) -> list[dict[str, Any]]:
        return self.registry.describe()

    def ensure_loaded(self) -> None:
        engine = self.registry.select_engine()
        self._last_engine_id = engine.id
        try:
            engine.ensure_ready()
            self._last_error = None
        except Exception as exc:  # noqa: BLE001
            self._last_error = str(exc)
            # Auto-fallback: structure → ocr when default fails (still server-side).
            if engine.id == "structure":
                logger.warning("Default structure engine failed (%s); falling back to ocr", exc)
                fallback = self.registry.get("ocr")
                fallback.ensure_ready()
                self._last_engine_id = fallback.id
                self._last_error = None
                self.registry.selection = FixedEngineStrategy("ocr")
                return
            raise

    def extract(
        self,
        file_path: Path,
        output_format: OutputFormat = "both",
        options: ExtractOptions | None = None,
        *,
        mime_type: str | None = None,
    ) -> dict[str, Any]:
        opts = options or DEFAULT_EXTRACT_OPTIONS
        engine = self.registry.select_engine()
        self._last_engine_id = engine.id

        try:
            result = engine.extract(
                file_path,
                output_format=output_format,
                options=opts,
                mime_type=mime_type,
            )
            self._last_error = None
            return result.to_dict()
        except Exception as exc:  # noqa: BLE001
            if engine.id == "structure":
                logger.warning("Structure extract failed (%s); retrying with PP-OCR", exc)
                fallback = self.registry.get("ocr")
                self._last_engine_id = fallback.id
                result = fallback.extract(
                    file_path,
                    output_format=output_format,
                    options=opts,
                    mime_type=mime_type,
                )
                self._last_error = None
                return result.to_dict()
            self._last_error = str(exc)
            raise


_service: OCRService | None = None
_service_lock = threading.Lock()


def get_ocr_service() -> OCRService:
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = OCRService()
    return _service


def dump_json(data: Any) -> str:
    return json.dumps(json_safe(data), ensure_ascii=False, indent=2)
