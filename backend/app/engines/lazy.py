"""Shared lazy loading for engines that hold a heavy local model.

The model is expensive (models are downloaded and take seconds to construct), so
one instance is shared by every run. The catch is what happens when a run is
abandoned: the work runs in a worker thread (see ``app.services.runtime``) and
cancelling the client request does not stop that thread. It keeps running while
holding the load lock, so a plain ``with self._lock`` makes every later run
block on it forever — the caller sees a second hang instead of an error.

So: wait a bounded time for another run's load, then fail with something
retryable, and let each attempt own its own error state instead of reporting
one left behind by an earlier run.
"""

from __future__ import annotations

import logging
import threading
import time
from abc import abstractmethod
from typing import Any

from app.core.config import Settings
from app.engines.base import OCREngine

logger = logging.getLogger(__name__)

DEFAULT_LOAD_TIMEOUT_S = 120.0


class LazyModelEngine(OCREngine):
    """An ``OCREngine`` whose model loads once, on first use."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._pipeline: Any = None
        self._lock = threading.Lock()
        self._init_error: str | None = None
        self._loading_since: float | None = None

    @property
    def ready(self) -> bool:
        return self._pipeline is not None

    @property
    def init_error(self) -> str | None:
        return self._init_error

    @property
    def loading(self) -> bool:
        """True while some run is inside ``_load``."""
        return self._loading_since is not None

    def _load_timeout(self) -> float:
        raw = getattr(self.settings, "engine_load_timeout_s", DEFAULT_LOAD_TIMEOUT_S)
        try:
            timeout = float(raw)
        except (TypeError, ValueError):
            return DEFAULT_LOAD_TIMEOUT_S
        return timeout if timeout > 0 else DEFAULT_LOAD_TIMEOUT_S

    def ensure_ready(self) -> None:
        if self._pipeline is not None:
            return
        timeout = self._load_timeout()
        acquired = self._lock.acquire(blocking=False)
        if not acquired:
            # Say so up front; a silent wait is indistinguishable from a hang.
            logger.warning(
                "%s is already loading for another request; waiting up to %.0fs",
                self.label,
                timeout,
            )
            waited_from = time.monotonic()
            acquired = self._lock.acquire(timeout=timeout)
            if acquired:
                logger.info(
                    "%s finished loading elsewhere after %.1fs",
                    self.label,
                    time.monotonic() - waited_from,
                )
        if not acquired:
            raise RuntimeError(self._still_loading_message(timeout))
        try:
            if self._pipeline is not None:
                return
            # This attempt owns the error state; do not report an older run's failure.
            self._init_error = None
            self._loading_since = time.monotonic()
            self._load()
        finally:
            self._loading_since = None
            self._lock.release()

    def _still_loading_message(self, timeout: float) -> str:
        started = self._loading_since
        elapsed = f"{time.monotonic() - started:.0f}s" if started is not None else "an earlier run"
        message = (
            f"{self.label} is still loading ({elapsed} so far) for another request and did not "
            f"finish within {timeout:.0f}s. Retry once it finishes, or restart the server if it "
            f"was cancelled mid-load."
        )
        logger.warning(message)
        return message

    @abstractmethod
    def _load(self) -> None:
        """Build the model. Set ``self._pipeline`` on success."""
