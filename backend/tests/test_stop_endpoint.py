"""HTTP-level Stop: POST /extract/cancel must end a run that is already working.

This is the scenario from the field report — Stop appeared to do nothing and the
next run queued 60s then failed with "Server is busy". Here the run is stopped
through the endpoint while a real child process is doing the work.
"""

from __future__ import annotations

import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import router
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.db.session import get_db
from app.services.runtime import get_conversion_gate, get_run_registry, reset_conversion_gate
from app.services.worker import shutdown_worker_pool


def _app(principal: Principal) -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_db] = lambda: None
    return app


def _basic_principal() -> Principal:
    user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
    return Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]


class StopEndpointTests(unittest.TestCase):
    """Uses the real subprocess path; conftest turns it off for other tests."""

    @pytest.fixture(autouse=True)
    def _subprocess_mode(self, monkeypatch: pytest.MonkeyPatch):
        from app.core.config import get_settings

        monkeypatch.setenv("CONVERT_IN_SUBPROCESS", "true")
        monkeypatch.setenv("CONVERT_MAX_CONCURRENT", "1")
        monkeypatch.setenv("FW_TEST_SLOW_CONVERT", "1")
        get_settings.cache_clear()
        reset_conversion_gate()
        yield
        shutdown_worker_pool()
        reset_conversion_gate()
        get_settings.cache_clear()

    def test_cancel_endpoint_stops_a_running_conversion(self) -> None:
        principal = _basic_principal()
        client = TestClient(_app(principal))
        run_id = "run-stop-me"
        outcome: dict = {}

        # A slow conversion: a text file the child will sit on via a patched reader
        # is not possible across processes, so use a PDF that needs real OCR work.
        pdf = _multipage_scan_bytes()

        def convert() -> None:
            with patch("app.api.routes.get_document_store") as store_fn:
                store_fn.return_value = MagicMock()
                res = client.post(
                    "/api/extract",
                    files={"file": ("scan.pdf", pdf, "application/pdf")},
                    data={"run_id": run_id, "output_format": "markdown"},
                )
                outcome["status"] = res.status_code
                outcome["body"] = res.text[:200]

        worker_thread = threading.Thread(target=convert, daemon=True)
        worker_thread.start()

        gate = get_conversion_gate()
        registry = get_run_registry()
        idle = threading.Event()
        for _ in range(600):
            handle = registry.get(run_id)
            if handle is not None and handle.worker is not None and gate.running >= 1:
                break
            idle.wait(0.05)
        handle = registry.get(run_id)
        self.assertIsNotNone(handle, "run never registered")
        assert handle is not None
        self.assertIsNotNone(handle.worker, "run never got a worker process")

        # Let the child enter the slow conversion loop before we cancel.
        idle.wait(0.5)
        self.assertTrue(worker_thread.is_alive(), "conversion finished before we could stop it")

        stopped_at = threading.Event()
        res = client.post("/api/extract/cancel", data={"run_id": run_id})
        stopped_at.set()
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["stopped"], res.json())

        worker_thread.join(timeout=30)
        self.assertFalse(worker_thread.is_alive(), "request did not return after cancel")
        self.assertEqual(outcome.get("status"), 499, outcome)

        # The decisive assertion: the slot is free, so the next run will not queue.
        self.assertEqual(gate.running, 0)
        self.assertEqual(gate.waiting, 0)
        self.assertIsNone(registry.get(run_id))

    def test_cancel_unknown_run_still_writes_a_tombstone(self) -> None:
        """Remote LLM runs are not in the local registry — the token is the Stop."""
        from app.services.cancel_token import is_cancelled

        client = TestClient(_app(_basic_principal()))
        res = client.post("/api/extract/cancel", data={"run_id": "nope"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["stopped"])
        self.assertTrue(is_cancelled("nope"))

    def test_cancel_requires_the_owning_client_for_local_kill(self) -> None:
        registry = get_run_registry()
        from app.services.runtime import RunHandle

        handle = RunHandle(run_id="owned", owner="user:someone-else", label="x.pdf")
        registry.add(handle)
        self.addCleanup(registry.remove, "owned")
        client = TestClient(_app(_basic_principal()))
        res = client.post("/api/extract/cancel", data={"run_id": "owned"})
        self.assertEqual(res.status_code, 200)
        # Tombstone is written (run_id is the capability), but the local process
        # is not killed because the owner does not match.
        self.assertTrue(res.json()["stopped"])
        self.assertTrue(res.json()["token_written"])
        self.assertFalse(handle.cancelled)


def _multipage_scan_bytes() -> bytes:
    """An image-only PDF: no text layer, so it goes to OCR and takes real time."""
    import io

    from PIL import Image, ImageDraw

    frames = []
    for index in range(8):
        img = Image.new("RGB", (1400, 1900), "white")
        draw = ImageDraw.Draw(img)
        for line in range(28):
            draw.text((40, 40 + line * 64), f"Page {index + 1} row {line} scanned 12345", fill="black")
        frames.append(img)
    buffer = io.BytesIO()
    frames[0].save(buffer, format="PDF", save_all=True, append_images=frames[1:])
    return buffer.getvalue()


if __name__ == "__main__":
    unittest.main()
