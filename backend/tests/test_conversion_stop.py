"""Explicit Stop must free the slot, whether the run is working or still queued.

The failure this covers: a Stop that never reached the server left the run
holding the only conversion slot, so the next run queued 60s and then failed
with "Server is busy". Cancellation is therefore driven by run id, not by
transport-level disconnect detection.
"""

from __future__ import annotations

import asyncio
import threading
import time
import unittest
from unittest.mock import patch

from app.services.runtime import (
    ConversionBusy,
    ConversionGate,
    RunHandle,
    RunRegistry,
    run_conversion,
)
from app.services.worker import ConversionCancelled


class FakeWorker:
    def __init__(self, duration: float = 10.0) -> None:
        self.duration = duration
        self.killed_with: str | None = None
        self.started = threading.Event()
        self._killed = threading.Event()

    def run(self, message: dict) -> dict:
        self.started.set()
        if self._killed.wait(timeout=self.duration):
            raise ConversionCancelled("Conversion stopped by the client")
        return {"markdown": "done", "filename": message.get("filename")}

    def kill(self, reason: str) -> None:
        self.killed_with = reason
        self._killed.set()


class FakePool:
    def __init__(self, *workers: FakeWorker) -> None:
        self.workers = list(workers)
        self.handed_out: list[FakeWorker] = []

    def acquire(self, timeout: float = 30.0) -> FakeWorker:
        worker = self.workers.pop(0)
        self.handed_out.append(worker)
        return worker

    def release(self, worker: FakeWorker) -> None:
        self.workers.append(worker)


class CancelWhileRunningTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancel_by_run_id_kills_worker_and_frees_the_slot(self) -> None:
        gate = ConversionGate(limit=1, queue_timeout_s=10)
        registry = RunRegistry()
        worker = FakeWorker(duration=10)
        pool = FakePool(worker)
        handle = RunHandle(run_id="run-1", owner="user:alice", label="big.pdf")
        registry.add(handle)

        with patch("app.services.runtime.get_worker_pool", return_value=pool):
            job = asyncio.ensure_future(
                gate.run_document({"filename": "big.pdf"}, label="big.pdf", handle=handle)
            )
            await asyncio.to_thread(worker.started.wait, 5)
            self.assertEqual(gate.running, 1)

            self.assertTrue(registry.cancel("run-1", owner="user:alice"))
            with self.assertRaises(ConversionCancelled):
                await job

        self.assertEqual(worker.killed_with, "stopped by the client")
        # The whole point: the slot must be free for the next run.
        self.assertEqual(gate.running, 0)
        self.assertEqual(gate.waiting, 0)

    async def test_owner_mismatch_cannot_cancel_someone_elses_run(self) -> None:
        registry = RunRegistry()
        handle = RunHandle(run_id="run-1", owner="user:alice", label="a.pdf")
        registry.add(handle)
        self.assertFalse(registry.cancel("run-1", owner="user:bob"))
        self.assertFalse(handle.cancelled)
        self.assertTrue(registry.cancel("run-1", owner="user:alice"))

    async def test_cancelling_an_unknown_run_is_not_an_error(self) -> None:
        self.assertFalse(RunRegistry().cancel("nope"))

    async def test_cancel_logs_prove_the_process_died(self) -> None:
        """A 'stopping...' line proves nothing; the log must report the outcome."""
        gate = ConversionGate(limit=1, queue_timeout_s=10)
        worker = FakeWorker(duration=10)
        pool = FakePool(worker)
        handle = RunHandle(run_id="run-9", owner="user:alice", label="proof.pdf")

        with patch("app.services.runtime.get_worker_pool", return_value=pool):
            job = asyncio.ensure_future(
                gate.run_document({"filename": "proof.pdf"}, label="proof.pdf", handle=handle)
            )
            await asyncio.to_thread(worker.started.wait, 5)
            with self.assertLogs("app.services.runtime", level="INFO") as logs:
                handle.request_cancel("stopped by the client")
                with self.assertRaises(ConversionCancelled):
                    await job

        text = "\n".join(logs.output)
        self.assertIn("CANCEL run=run-9", text)
        self.assertIn("proof.pdf", text)
        self.assertIn("SLOT RELEASED", text)
        # The released state must be visible, so a reader knows the next run can go.
        self.assertIn("running=0/1", text)


class CancelWhileQueuedTests(unittest.IsolatedAsyncioTestCase):
    async def test_a_queued_run_stops_without_waiting_for_the_timeout(self) -> None:
        gate = ConversionGate(limit=1, queue_timeout_s=30)
        registry = RunRegistry()
        holder = FakeWorker(duration=10)
        queued_worker = FakeWorker(duration=0.05)
        pool = FakePool(holder, queued_worker)

        first = RunHandle(run_id="run-1", owner="user:alice", label="first.pdf")
        second = RunHandle(run_id="run-2", owner="user:bob", label="second.pdf")
        registry.add(first)
        registry.add(second)

        with patch("app.services.runtime.get_worker_pool", return_value=pool):
            job_one = asyncio.ensure_future(
                gate.run_document({"filename": "first.pdf"}, label="first.pdf", handle=first)
            )
            await asyncio.to_thread(holder.started.wait, 5)

            job_two = asyncio.ensure_future(
                gate.run_document({"filename": "second.pdf"}, label="second.pdf", handle=second)
            )
            while gate.waiting < 1:
                await asyncio.sleep(0.01)

            started = time.monotonic()
            registry.cancel("run-2", owner="user:bob")
            with self.assertRaises(ConversionCancelled):
                await job_two
            elapsed = time.monotonic() - started

            registry.cancel("run-1", owner="user:alice")
            with self.assertRaises(ConversionCancelled):
                await job_one

        self.assertLess(elapsed, 5, "a stopped queued run must not wait for the queue timeout")
        self.assertIsNone(queued_worker.killed_with, "queued run never started a worker")
        self.assertEqual(gate.waiting, 0)
        self.assertEqual(gate.running, 0)

    async def test_busy_still_reported_when_nothing_is_cancelled(self) -> None:
        gate = ConversionGate(limit=1, queue_timeout_s=0.2)
        holder = FakeWorker(duration=5)
        pool = FakePool(holder, FakeWorker())
        handle = RunHandle(run_id="run-1", owner="o", label="held.pdf")
        with patch("app.services.runtime.get_worker_pool", return_value=pool):
            job = asyncio.ensure_future(
                gate.run_document({"filename": "held.pdf"}, label="held.pdf", handle=handle)
            )
            await asyncio.to_thread(holder.started.wait, 5)
            with self.assertRaises(ConversionBusy):
                await gate.run_document({"filename": "q.pdf"}, label="q.pdf")
            handle.request_cancel("test")
            with self.assertRaises(ConversionCancelled):
                await job
        self.assertEqual(gate.waiting, 0)


class PreemptionTests(unittest.IsolatedAsyncioTestCase):
    """A missed Stop must not make the next run queue behind a dead one."""

    async def test_new_run_supersedes_the_same_owners_stale_run(self) -> None:
        gate = ConversionGate(limit=1, queue_timeout_s=10)
        registry = RunRegistry()
        stale = FakeWorker(duration=10)
        fresh = FakeWorker(duration=0.05)
        pool = FakePool(stale, fresh)

        settings = type("S", (), {"convert_in_subprocess": True})()

        with patch("app.services.runtime.get_worker_pool", return_value=pool), patch(
            "app.services.runtime.get_conversion_gate", return_value=gate
        ), patch("app.services.runtime.get_run_registry", return_value=registry), patch(
            "app.services.runtime.get_settings", return_value=settings
        ):
            from pathlib import Path

            first = asyncio.ensure_future(
                run_conversion(
                    Path("/tmp/stale.pdf"),
                    filename="stale.pdf",
                    run_id="run-1",
                    owner="user:alice",
                )
            )
            await asyncio.to_thread(stale.started.wait, 5)

            # Same owner starts a new run: the stale one is killed, not queued behind.
            second = asyncio.ensure_future(
                run_conversion(
                    Path("/tmp/fresh.pdf"),
                    filename="fresh.pdf",
                    run_id="run-2",
                    owner="user:alice",
                )
            )
            with self.assertRaises(ConversionCancelled):
                await first
            result = await second

        self.assertEqual(result["markdown"], "done")
        self.assertEqual(stale.killed_with, "superseded by a newer run")
        self.assertEqual(registry.snapshot(), [])

    async def test_a_different_owner_is_not_preempted(self) -> None:
        registry = RunRegistry()
        alice = RunHandle(run_id="a", owner="user:alice", label="a.pdf")
        bob = RunHandle(run_id="b", owner="user:bob", label="b.pdf")
        registry.add(alice)
        registry.add(bob)
        cancelled = registry.cancel_owner("user:alice", except_run_id=None, reason="new run")
        self.assertEqual(cancelled, 1)
        self.assertTrue(alice.cancelled)
        self.assertFalse(bob.cancelled)


if __name__ == "__main__":
    unittest.main()
