"""Per-run isolation: an abandoned or failed run must not wedge or taint the next one."""

from __future__ import annotations

import threading
import unittest
from pathlib import Path

from app.core.config import Settings, get_settings
from app.engines.base import ExtractResult, OutputFormat
from app.engines.lazy import LazyModelEngine
from app.services.options import ExtractOptions


class _FakeEngine(LazyModelEngine):
    id = "fake"
    label = "Fake model"

    def __init__(self, settings: Settings) -> None:
        super().__init__(settings)
        self.block = threading.Event()
        self.entered = threading.Event()
        self.attempts = 0
        self.fail_times = 0

    def _load(self) -> None:
        self.attempts += 1
        self.entered.set()
        self.block.wait(timeout=10)
        if self.attempts <= self.fail_times:
            self._init_error = f"{self.label} init failed: boom"
            raise RuntimeError(self._init_error)
        self._pipeline = object()

    def extract(
        self,
        file_path: Path,
        *,
        output_format: OutputFormat = "both",
        options: ExtractOptions | None = None,
        mime_type: str | None = None,
    ) -> ExtractResult:
        raise NotImplementedError


def _settings(timeout: float) -> Settings:
    return get_settings().model_copy(update={"engine_load_timeout_s": timeout})


class LazyLoadIsolationTests(unittest.TestCase):
    def test_abandoned_load_does_not_hang_the_next_run(self) -> None:
        """A cancelled request keeps its worker thread and the load lock; waiters must not block."""
        engine = _FakeEngine(_settings(0.2))
        stuck = threading.Thread(target=engine.ensure_ready, daemon=True)
        stuck.start()
        self.assertTrue(engine.entered.wait(timeout=5), "first run never reached _load")
        self.assertTrue(engine.loading)

        with self.assertRaises(RuntimeError) as caught:
            engine.ensure_ready()
        message = str(caught.exception)
        self.assertIn("still loading", message)
        self.assertIn("Retry", message)

        engine.block.set()
        stuck.join(timeout=5)
        self.assertTrue(engine.ready)
        self.assertFalse(engine.loading)

    def test_retry_clears_the_previous_attempts_error(self) -> None:
        engine = _FakeEngine(_settings(5))
        engine.fail_times = 1
        engine.block.set()

        with self.assertRaises(RuntimeError):
            engine.ensure_ready()
        self.assertIsNotNone(engine.init_error)
        self.assertFalse(engine.ready)

        # Second run retries instead of replaying the stored failure.
        engine.ensure_ready()
        self.assertEqual(engine.attempts, 2)
        self.assertTrue(engine.ready)
        self.assertIsNone(engine.init_error)

    def test_load_timeout_falls_back_to_a_sane_default(self) -> None:
        engine = _FakeEngine(_settings(0))
        self.assertEqual(engine._load_timeout(), 120.0)


class OCRServiceStateTests(unittest.TestCase):
    def test_failed_warmup_does_not_repin_the_engine(self) -> None:
        from app.services.ocr import OCRService

        service = OCRService(get_settings().model_copy(update={"ocr_engine": "structure", "paddle_ocr_enabled": True}))
        before = service.registry.selection.select()
        self.assertEqual(before, "structure")

        structure = service.registry.get("structure")
        ocr = service.registry.get("ocr")

        def fail() -> None:
            raise RuntimeError("structure unavailable")

        structure.ensure_ready = fail  # type: ignore[method-assign]
        ocr.ensure_ready = lambda: None  # type: ignore[method-assign]
        service.ensure_loaded()

        # One bad warmup must not decide the engine for every later run.
        self.assertEqual(service.registry.selection.select(), "structure")

    def test_init_error_is_live_not_a_stale_run(self) -> None:
        from app.services.ocr import OCRService

        service = OCRService(get_settings().model_copy(update={"ocr_engine": "ocr"}))
        engine = service.registry.get("ocr")
        engine._init_error = "old failure from a previous run"  # type: ignore[attr-defined]
        self.assertEqual(service.init_error, "old failure from a previous run")

        engine._init_error = None  # type: ignore[attr-defined]
        self.assertIsNone(service.init_error)


if __name__ == "__main__":
    unittest.main()
