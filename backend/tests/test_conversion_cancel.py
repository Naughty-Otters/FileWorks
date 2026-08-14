"""Stop must end the work, and the next run must still succeed.

Native inference has no cancellation point, so cancelling means killing the
process. Two things have to hold: a disconnect ends the job promptly, and the
worker comes back for the next request.
"""

from __future__ import annotations

import threading
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from app.core.config import get_settings
from app.services.runtime import ConversionGate
from app.services.worker import ConversionCancelled, ConversionWorker, WorkerPool


class FakeWorker:
    """Stands in for a child process: blocks until killed or finished."""

    def __init__(self, duration: float = 5.0) -> None:
        self.duration = duration
        self.killed_with: str | None = None
        self._killed = threading.Event()

    def run(self, message: dict) -> dict:
        if self._killed.wait(timeout=self.duration):
            raise ConversionCancelled("Conversion stopped by the client")
        return {"markdown": "done", "filename": message.get("filename")}

    def kill(self, reason: str) -> None:
        self.killed_with = reason
        self._killed.set()


class FakePool:
    def __init__(self, worker: FakeWorker) -> None:
        self.worker = worker
        self.released = 0

    def acquire(self, timeout: float = 30.0) -> FakeWorker:
        return self.worker

    def release(self, worker: FakeWorker) -> None:
        self.released += 1


class CancellationPlumbingTests(unittest.IsolatedAsyncioTestCase):
    async def test_disconnect_stops_the_conversion(self) -> None:
        gate = ConversionGate(limit=1, queue_timeout_s=5)
        worker = FakeWorker(duration=10)
        pool = FakePool(worker)
        probes = 0

        async def is_disconnected() -> bool:
            nonlocal probes
            probes += 1
            return probes >= 2

        with patch("app.services.runtime.get_worker_pool", return_value=pool):
            started = time.monotonic()
            with self.assertRaises(ConversionCancelled):
                await gate.run_document(
                    {"filename": "slow.pdf"}, label="slow.pdf", is_disconnected=is_disconnected
                )
        self.assertLess(time.monotonic() - started, 5, "kill did not unblock the job promptly")
        self.assertEqual(worker.killed_with, "client disconnected")
        # The slot and the worker must go back, or the next run has nothing to use.
        self.assertEqual(pool.released, 1)
        self.assertEqual(gate.running, 0)
        self.assertEqual(gate.waiting, 0)

    async def test_connected_client_keeps_its_result(self) -> None:
        gate = ConversionGate(limit=1, queue_timeout_s=5)
        worker = FakeWorker(duration=0.05)
        pool = FakePool(worker)

        async def is_disconnected() -> bool:
            return False

        with patch("app.services.runtime.get_worker_pool", return_value=pool):
            result = await gate.run_document(
                {"filename": "ok.pdf"}, label="ok.pdf", is_disconnected=is_disconnected
            )
        self.assertEqual(result["markdown"], "done")
        self.assertIsNone(worker.killed_with)
        self.assertEqual(gate.running, 0)

    async def test_a_failing_probe_does_not_kill_the_job(self) -> None:
        gate = ConversionGate(limit=1, queue_timeout_s=5)
        worker = FakeWorker(duration=0.05)
        pool = FakePool(worker)

        async def is_disconnected() -> bool:
            raise RuntimeError("receive channel is gone")

        with patch("app.services.runtime.get_worker_pool", return_value=pool):
            result = await gate.run_document(
                {"filename": "ok.pdf"}, label="ok.pdf", is_disconnected=is_disconnected
            )
        self.assertEqual(result["markdown"], "done")
        self.assertIsNone(worker.killed_with)


class RealWorkerProcessTests(unittest.TestCase):
    """Exercises the process boundary with a reader that needs no heavy model."""

    def test_converts_across_the_process_boundary_and_survives_a_kill(self) -> None:
        worker = ConversionWorker(get_settings(), index=0)
        self.addCleanup(worker.shutdown)
        with TemporaryDirectory() as tmp:
            source = Path(tmp) / "note.txt"
            source.write_text("hello from another process", encoding="utf-8")
            message = {
                "path": str(source),
                "output_format": "markdown",
                "options": {},
                "mime_type": "text/plain",
                "filename": "note.txt",
            }

            result = worker.run(message)
            self.assertIn("hello from another process", result["markdown"] or "")
            first_pid = worker.pid
            self.assertIsNotNone(first_pid)

            worker.kill("test stop")
            self.assertFalse(worker.alive)

            # A killed worker must not poison later runs.
            again = worker.run(message)
            self.assertIn("hello from another process", again["markdown"] or "")
            self.assertNotEqual(worker.pid, first_pid, "expected a fresh worker process")

    def test_worker_reports_failure_without_dying(self) -> None:
        worker = ConversionWorker(get_settings(), index=0)
        self.addCleanup(worker.shutdown)
        message = {
            "path": "/nonexistent/never-here.txt",
            "output_format": "markdown",
            "options": {},
            "mime_type": "text/plain",
            "filename": "never-here.txt",
        }
        with self.assertRaises(RuntimeError) as caught:
            worker.run(message)
        self.assertNotIsInstance(caught.exception, ConversionCancelled)
        self.assertTrue(worker.alive, "a failed job must not take the worker down")


class WorkerPoolTests(unittest.TestCase):
    def test_pool_hands_out_and_takes_back_workers(self) -> None:
        pool = WorkerPool(get_settings(), size=2)
        self.addCleanup(pool.shutdown)
        first = pool.acquire(timeout=1)
        second = pool.acquire(timeout=1)
        self.assertIsNot(first, second)
        pool.release(first)
        self.assertIs(pool.acquire(timeout=1), first)

    def test_size_is_at_least_one(self) -> None:
        pool = WorkerPool(get_settings(), size=0)
        self.addCleanup(pool.shutdown)
        self.assertEqual(pool.size, 1)


if __name__ == "__main__":
    unittest.main()
