"""Concurrency gate and cancellation for document conversion.

Conversion is blocking CPU work (Paddle inference, PDF rasterizing). Handled
badly it produces two symptoms that both look like "the server hung":

1. Run it directly inside an ``async def`` endpoint and it occupies the event
   loop. Nothing else is served while it runs — not a second convert, not
   ``/health``, not even the client's disconnect when someone hits Stop.
2. Run unlimited copies at once and the box thrashes instead of finishing.

So work goes to a killable child process (see ``app.services.worker``), a
bounded number at a time, and a queued run says so in the log immediately
instead of waiting in silence.

Stopping is deliberately not left to transport-level disconnect detection.
Behind a proxy or container port forward, ``http.disconnect`` may arrive late or
never, and then a "stopped" run keeps holding the only slot while the next one
queues behind it. Instead every run gets an id in a registry, so a Stop is an
explicit request that kills a named run, and starting a new run preempts the
same owner's earlier one. Disconnect watching stays as a backup.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, TypeVar

from starlette.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.services.options import ExtractOptions
from app.services.worker import ConversionCancelled, get_worker_pool

logger = logging.getLogger(__name__)

T = TypeVar("T")

DISCONNECT_POLL_S = 0.5
CANCEL_POLL_S = 0.25
ANONYMOUS_OWNER = "anonymous"


class ConversionBusy(RuntimeError):
    """Every slot was taken for longer than the queue timeout."""


class RunHandle:
    """One in-flight conversion that can be cancelled while queued or running."""

    def __init__(self, *, run_id: str, owner: str, label: str) -> None:
        self.run_id = run_id
        self.owner = owner
        self.label = label
        self.started_at = time.monotonic()
        self.worker: Any = None
        self.reason: str = "cancelled"
        # A plain threading.Event: cancel can arrive from a request handler while
        # the run itself blocks in a worker thread. Polled rather than tied to a
        # loop, so no cross-thread loop handoff is needed.
        self._cancelled = threading.Event()

    @property
    def cancelled(self) -> bool:
        return self._cancelled.is_set()

    @property
    def age_s(self) -> float:
        return time.monotonic() - self.started_at

    def attach(self, worker: Any) -> None:
        self.worker = worker

    async def wait_cancelled(self, poll_s: float = CANCEL_POLL_S) -> None:
        while not self._cancelled.is_set():
            await asyncio.sleep(poll_s)

    def request_cancel(self, reason: str = "stopped by the client") -> bool:
        """Mark cancelled and kill the child process if one is already running."""
        if self._cancelled.is_set():
            logger.info(
                "Cancel ignored for run=%s (%s): already cancelled as '%s'",
                self.run_id,
                self.label,
                self.reason,
            )
            return False
        self.reason = reason
        self._cancelled.set()
        worker = self.worker
        if worker is None:
            logger.warning(
                "CANCEL run=%s file=%s owner=%s: queued %.1fs, not started — "
                "it will not take a conversion slot (%s)",
                self.run_id,
                self.label,
                self.owner,
                self.age_s,
                reason,
            )
            return True

        pid = getattr(worker, "pid", None)
        logger.warning(
            "CANCEL run=%s file=%s owner=%s: running %.1fs in pid=%s — terminating (%s)",
            self.run_id,
            self.label,
            self.owner,
            self.age_s,
            pid,
            reason,
        )
        killed = worker.kill(reason)
        if killed:
            logger.warning(
                "CANCEL run=%s file=%s: work stopped after %.1fs; slot will be released",
                self.run_id,
                self.label,
                self.age_s,
            )
        else:
            logger.warning(
                "CANCEL run=%s file=%s: no live process to stop (it had just finished or died)",
                self.run_id,
                self.label,
            )
        return True


class RunRegistry:
    """Tracks in-flight conversions so they can be cancelled by id."""

    def __init__(self) -> None:
        self._runs: dict[str, RunHandle] = {}
        self._lock = threading.Lock()

    def add(self, handle: RunHandle) -> None:
        with self._lock:
            self._runs[handle.run_id] = handle

    def remove(self, run_id: str) -> None:
        with self._lock:
            self._runs.pop(run_id, None)

    def get(self, run_id: str) -> RunHandle | None:
        with self._lock:
            return self._runs.get(run_id)

    def cancel(self, run_id: str, *, owner: str | None = None, reason: str = "stopped by the client") -> bool:
        """Cancel one run. With ``owner`` set, only that owner's run is touched."""
        handle = self.get(run_id)
        if handle is None:
            logger.info("Cancel requested for unknown run %s (already finished?)", run_id)
            return False
        if owner is not None and handle.owner != owner:
            logger.warning("Refusing to cancel run %s: owner mismatch", run_id)
            return False
        return handle.request_cancel(reason)

    def cancel_owner(self, owner: str, *, except_run_id: str | None = None, reason: str) -> int:
        """Cancel every run for one owner. Used to preempt a stale run."""
        with self._lock:
            targets = [
                handle
                for handle in self._runs.values()
                if handle.owner == owner and handle.run_id != except_run_id
            ]
        return sum(1 for handle in targets if handle.request_cancel(reason))

    def snapshot(self) -> list[dict[str, Any]]:
        with self._lock:
            return [
                {
                    "run_id": handle.run_id,
                    "label": handle.label,
                    "age_s": round(handle.age_s, 1),
                    "started": handle.worker is not None,
                }
                for handle in self._runs.values()
            ]


_registry = RunRegistry()


def get_run_registry() -> RunRegistry:
    return _registry


class ConversionGate:
    """Runs blocking conversions off the event loop, a bounded number at a time."""

    def __init__(self, *, limit: int = 2, queue_timeout_s: float = 60.0) -> None:
        self.limit = max(1, int(limit))
        self.queue_timeout_s = float(queue_timeout_s) if queue_timeout_s > 0 else 60.0
        self._semaphore = asyncio.Semaphore(self.limit)
        self._running = 0
        self._waiting = 0

    @property
    def running(self) -> int:
        return self._running

    @property
    def waiting(self) -> int:
        return self._waiting

    def snapshot(self) -> dict[str, int]:
        return {"running": self._running, "waiting": self._waiting, "limit": self.limit}

    async def run(self, work: Callable[[], T], *, label: str) -> T:
        """Wait for a slot, then run ``work`` in a worker thread."""
        await self._acquire(label)
        self._running += 1
        try:
            return await run_in_threadpool(work)
        finally:
            self._running -= 1
            self._semaphore.release()

    async def run_document(
        self,
        message: dict[str, Any],
        *,
        label: str,
        handle: RunHandle | None = None,
        is_disconnected: Callable[[], Awaitable[bool]] | None = None,
    ) -> dict[str, Any]:
        """Convert in a killable child process; a cancelled run ends promptly."""
        await self._acquire(label, handle=handle)
        self._running += 1
        pool = get_worker_pool()
        worker = pool.acquire()
        try:
            if handle is not None:
                # It may have been stopped while queued for this slot.
                if handle.cancelled:
                    raise ConversionCancelled(f"Conversion {handle.reason}")
                handle.attach(worker)
            job = asyncio.ensure_future(run_in_threadpool(lambda: worker.run(message)))
            watchers: list[asyncio.Task[None]] = []
            if is_disconnected is not None:
                watchers.append(
                    asyncio.ensure_future(self._stop_if_gone(is_disconnected, worker, label))
                )
            try:
                return await job
            except asyncio.CancelledError:
                # The server is tearing the request down; don't leave work running.
                await run_in_threadpool(lambda: worker.kill("request cancelled"))
                raise
            finally:
                for watcher in watchers:
                    watcher.cancel()
        finally:
            pool.release(worker)
            self._running -= 1
            self._semaphore.release()
            if handle is not None and handle.cancelled:
                # Closes the loop on a Stop: the slot is provably back.
                logger.warning(
                    "SLOT RELEASED after cancel run=%s file=%s (running=%s/%s, waiting=%s) — "
                    "the next conversion can start now",
                    handle.run_id,
                    label,
                    self._running,
                    self.limit,
                    self._waiting,
                )

    @staticmethod
    async def _stop_if_gone(
        is_disconnected: Callable[[], Awaitable[bool]],
        worker: Any,
        label: str,
    ) -> None:
        while True:
            await asyncio.sleep(DISCONNECT_POLL_S)
            try:
                gone = await is_disconnected()
            except Exception:  # noqa: BLE001 - a probe failure must not kill the job
                return
            if not gone:
                continue
            logger.warning("Client stopped listening; ending conversion of %s", label)
            # Off the loop: terminate + join can take a moment.
            await run_in_threadpool(lambda: worker.kill("client disconnected"))
            return

    async def _acquire(self, label: str, *, handle: RunHandle | None = None) -> None:
        queued = self._semaphore.locked()
        started = time.monotonic()
        if queued:
            self._waiting += 1
            logger.warning(
                "Waiting for a conversion slot: %s (running=%s/%s, waiting=%s, giving up after %.0fs)",
                label,
                self._running,
                self.limit,
                self._waiting,
                self.queue_timeout_s,
            )
        try:
            await self._acquire_or_cancel(label, handle)
        finally:
            if queued:
                self._waiting -= 1
        if queued:
            logger.info(
                "Conversion slot free for %s after waiting %.1fs", label, time.monotonic() - started
            )

    async def _acquire_or_cancel(self, label: str, handle: RunHandle | None) -> None:
        """Take a slot, but give up early if this run is cancelled while queued."""
        acquire = asyncio.ensure_future(self._semaphore.acquire())
        cancel_wait = (
            asyncio.ensure_future(handle.wait_cancelled()) if handle is not None else None
        )
        waiters: set[asyncio.Future[Any]] = {acquire}
        if cancel_wait is not None:
            waiters.add(cancel_wait)

        try:
            done, _pending = await asyncio.wait(
                waiters,
                timeout=self.queue_timeout_s,
                return_when=asyncio.FIRST_COMPLETED,
            )
        except asyncio.CancelledError:
            acquire.cancel()
            if cancel_wait is not None:
                cancel_wait.cancel()
            raise

        if cancel_wait is not None:
            cancel_wait.cancel()

        if acquire in done:
            if handle is not None and handle.cancelled:
                # Stopped just as the slot opened; hand it to the next run instead.
                self._semaphore.release()
                raise ConversionCancelled(f"Conversion {handle.reason}")
            return

        # We did not get the slot: undo the pending acquire. asyncio.Semaphore
        # re-releases a grant that lands during cancellation, so nothing to fix up.
        acquire.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await acquire

        if handle is not None and handle.cancelled:
            logger.warning("Gave up queuing %s: %s", label, handle.reason)
            raise ConversionCancelled(f"Conversion {handle.reason}")

        message = (
            f"Server is busy: {self._running} conversion(s) already running and this request "
            f"waited {self.queue_timeout_s:.0f}s for a slot. Retry in a moment."
        )
        logger.warning("%s — %s", message, label)
        raise ConversionBusy(message)


_gate: ConversionGate | None = None
_gate_lock = threading.Lock()


def get_conversion_gate() -> ConversionGate:
    global _gate
    if _gate is None:
        with _gate_lock:
            if _gate is None:
                settings = get_settings()
                _gate = ConversionGate(
                    limit=settings.convert_max_concurrent,
                    queue_timeout_s=settings.convert_queue_timeout_s,
                )
                logger.info(
                    "Conversion gate ready (max_concurrent=%s, queue_timeout=%.0fs)",
                    _gate.limit,
                    _gate.queue_timeout_s,
                )
    return _gate


def reset_conversion_gate() -> None:
    """Drop the cached gate so new settings apply (tests)."""
    global _gate
    with _gate_lock:
        _gate = None


def cancel_run(run_id: str, *, owner: str | None = None) -> bool:
    """Stop a named run. Returns False when it already finished."""
    return get_run_registry().cancel(run_id, owner=owner)


async def run_conversion(
    path: Path,
    *,
    output_format: str = "both",
    options: ExtractOptions | None = None,
    mime_type: str | None = None,
    filename: str | None = None,
    request: Any | None = None,
    run_id: str | None = None,
    owner: str | None = None,
) -> dict[str, Any]:
    """Convert one document off the event loop, cancellable by ``run_id``."""
    gate = get_conversion_gate()
    label = filename or path.name
    resolved = options or ExtractOptions()
    resolved_run_id = run_id or uuid.uuid4().hex

    if not get_settings().convert_in_subprocess:
        from app.services.cancel_token import cancel_scope
        from app.services.convert import convert_document

        def work() -> dict[str, Any]:
            with cancel_scope(resolved_run_id):
                return convert_document(
                    path,
                    output_format=output_format,  # type: ignore[arg-type]
                    options=resolved,
                    mime_type=mime_type,
                    filename=filename,
                )

        return await gate.run(work, label=label)

    registry = get_run_registry()
    handle = RunHandle(
        run_id=resolved_run_id,
        owner=owner or ANONYMOUS_OWNER,
        label=label,
    )
    message = {
        "path": str(path),
        "output_format": output_format,
        "options": resolved.to_dict(),
        "mime_type": mime_type,
        "filename": filename,
        "run_id": handle.run_id,
    }

    # A Stop that never reached us (dropped disconnect, closed tab) must not make
    # this run queue behind a dead one. Starting a new run supersedes the old.
    superseded = registry.cancel_owner(
        handle.owner,
        except_run_id=handle.run_id,
        reason="superseded by a newer run",
    )
    if superseded:
        logger.warning(
            "Superseded %s earlier run(s) for this client before starting %s", superseded, label
        )

    registry.add(handle)
    try:
        return await gate.run_document(
            message,
            label=label,
            handle=handle,
            is_disconnected=getattr(request, "is_disconnected", None),
        )
    finally:
        registry.remove(handle.run_id)


__all__ = [
    "ANONYMOUS_OWNER",
    "ConversionBusy",
    "ConversionCancelled",
    "ConversionGate",
    "RunHandle",
    "RunRegistry",
    "cancel_run",
    "get_conversion_gate",
    "get_run_registry",
    "reset_conversion_gate",
    "run_conversion",
]
