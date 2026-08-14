"""The event loop must stay free while a conversion runs, and queued runs must be visible."""

from __future__ import annotations

import asyncio
import threading
import time
import unittest

from app.services.runtime import ConversionBusy, ConversionGate


class ConversionGateTests(unittest.IsolatedAsyncioTestCase):
    async def test_blocking_work_leaves_the_event_loop_free(self) -> None:
        """A convert used to run inline in an async endpoint, freezing every other request."""
        gate = ConversionGate(limit=2, queue_timeout_s=5)
        ticks = 0

        async def heartbeat() -> None:
            nonlocal ticks
            while True:
                await asyncio.sleep(0.01)
                ticks += 1

        beat = asyncio.create_task(heartbeat())
        try:
            await gate.run(lambda: time.sleep(0.3), label="slow.pdf")
        finally:
            beat.cancel()
        self.assertGreater(ticks, 5, "event loop was blocked while the conversion ran")

    async def test_runs_are_capped_and_queue_is_reported(self) -> None:
        gate = ConversionGate(limit=1, queue_timeout_s=5)
        release = threading.Event()
        seen: list[int] = []

        async def job(name: str) -> None:
            await gate.run(lambda: release.wait(timeout=5), label=name)

        first = asyncio.create_task(job("a.pdf"))
        while gate.running < 1:
            await asyncio.sleep(0.01)

        second = asyncio.create_task(job("b.pdf"))
        while gate.waiting < 1:
            await asyncio.sleep(0.01)
        seen.append(gate.running)
        self.assertEqual(gate.running, 1, "limit=1 must not run two conversions at once")
        self.assertEqual(gate.waiting, 1)
        self.assertEqual(gate.snapshot(), {"running": 1, "waiting": 1, "limit": 1})

        release.set()
        await asyncio.gather(first, second)
        self.assertEqual(gate.running, 0)
        self.assertEqual(gate.waiting, 0)
        self.assertEqual(seen, [1])

    async def test_busy_server_reports_instead_of_waiting_forever(self) -> None:
        gate = ConversionGate(limit=1, queue_timeout_s=0.15)
        release = threading.Event()
        held = asyncio.create_task(gate.run(lambda: release.wait(timeout=5), label="held.pdf"))
        while gate.running < 1:
            await asyncio.sleep(0.01)

        with self.assertRaises(ConversionBusy) as caught:
            await gate.run(lambda: None, label="queued.pdf")
        self.assertIn("busy", str(caught.exception).lower())
        self.assertIn("Retry", str(caught.exception))

        release.set()
        await held
        # A timed-out waiter must not leak its slot.
        self.assertEqual(gate.waiting, 0)
        await gate.run(lambda: None, label="after.pdf")
        self.assertEqual(gate.running, 0)

    async def test_limit_and_timeout_are_sanitized(self) -> None:
        gate = ConversionGate(limit=0, queue_timeout_s=0)
        self.assertEqual(gate.limit, 1)
        self.assertEqual(gate.queue_timeout_s, 60.0)


if __name__ == "__main__":
    unittest.main()
