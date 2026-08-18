"""Conversion in a separate, killable OS process.

Stop has to actually stop. Paddle inference is native code with no Python
cancellation point, so a conversion running in a thread cannot be interrupted —
the only way to end it early is to end the process running it.

So each conversion runs in a long-lived child process that holds the warm
models. Normal runs reuse it, and it stays warm across requests. When the client
disconnects we terminate it, which unblocks the parent's ``recv`` immediately;
the next run spawns a replacement. That replacement reloads models, so killing
is not free — it is the price of a Stop that truly stops.

``spawn`` is used deliberately (not ``fork``): forking a process that already
holds Paddle/OpenMP threads is a known source of deadlocks.
"""

from __future__ import annotations

import importlib.util
import logging
import multiprocessing
import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings

logger = logging.getLogger(__name__)

_SHUTDOWN = None
_KILL_JOIN_S = 5.0


class ConversionCancelled(RuntimeError):
    """The worker was killed because the client went away."""


class WorkerCrashed(RuntimeError):
    """The worker died on its own (OOM killer, segfault, ...)."""


def _convert_from_message(message: dict[str, Any]) -> dict[str, Any]:
    from app.services.cancel_token import cancel_scope, check_cancelled
    from app.services.convert import convert_document
    from app.services.options import ExtractOptions

    options = ExtractOptions.from_form(**(message.get("options") or {}))
    run_id = str(message.get("run_id") or "").strip() or None
    with cancel_scope(run_id):
        check_cancelled(where="worker start")
        return convert_document(
            Path(message["path"]),
            output_format=message.get("output_format", "both"),
            options=options,
            mime_type=message.get("mime_type"),
            filename=message.get("filename"),
        )


def _worker_main(conn: Any, prewarm: bool) -> None:
    """Child entrypoint: serve conversions over ``conn`` until told to stop."""
    from app.core.logsetup import configure_app_logging
    from app.core.venvpath import ensure_venv_on_sys_path

    ensure_venv_on_sys_path()
    if Path("/var/task").is_dir():
        os.chdir("/var/task")
    configure_app_logging()
    log = logging.getLogger("app.services.worker")
    log.info(
        "Conversion worker pid=%s ready python=%s",
        os.getpid(),
        sys.executable,
    )
    for name in ("liteparse", "docling"):
        spec = importlib.util.find_spec(name)
        origin = getattr(spec, "origin", None) if spec is not None else None
        log.info("worker import %s origin=%s", name, origin)

    if prewarm:
        try:
            from app.services.ocr import get_ocr_service

            get_ocr_service().ensure_loaded()
            log.info("Conversion worker pid=%s prewarmed models", os.getpid())
        except Exception as exc:  # noqa: BLE001
            log.warning("Worker prewarm failed (%s); models load on first job", exc)

    while True:
        try:
            message = conn.recv()
        except (EOFError, OSError, KeyboardInterrupt):
            break
        if message is _SHUTDOWN or message is None:
            break
        try:
            payload = {"ok": True, "result": _convert_from_message(message)}
        except Exception as exc:  # noqa: BLE001
            log.warning("Conversion failed in worker: %s", exc)
            payload = {"ok": False, "error": f"{type(exc).__name__}: {exc}"}
        try:
            conn.send(payload)
        except (BrokenPipeError, OSError):
            break
    log.info("Conversion worker pid=%s exiting", os.getpid())


class ConversionWorker:
    """Parent-side handle on one child process."""

    def __init__(self, settings: Settings, index: int = 0) -> None:
        self.settings = settings
        self.index = index
        self._ctx = multiprocessing.get_context("spawn")
        self._proc: Any = None
        self._conn: Any = None
        self._lock = threading.Lock()
        self._killed = False

    @property
    def alive(self) -> bool:
        return self._proc is not None and self._proc.is_alive()

    @property
    def pid(self) -> int | None:
        return getattr(self._proc, "pid", None)

    def ensure_started(self) -> None:
        with self._lock:
            if self.alive:
                return
            self._close_locked()
            prewarm = bool(getattr(self.settings, "convert_worker_prewarm", False))
            parent_conn, child_conn = self._ctx.Pipe(duplex=True)
            proc = self._ctx.Process(
                target=_worker_main,
                args=(child_conn, prewarm),
                name=f"fw-convert-{self.index}",
                daemon=True,
            )
            proc.start()
            child_conn.close()  # only the child needs its end
            self._proc = proc
            self._conn = parent_conn
            self._killed = False
            logger.info("Started conversion worker pid=%s (models load on first job)", proc.pid)

    def run(self, message: dict[str, Any]) -> dict[str, Any]:
        """Blocking: send one job and wait. Raises if the worker is killed or dies."""
        self.ensure_started()
        self._killed = False
        conn = self._conn
        if conn is None:  # pragma: no cover - ensure_started guarantees a conn
            raise WorkerCrashed("conversion worker is not running")
        try:
            conn.send(message)
            reply = conn.recv()
        except (EOFError, BrokenPipeError, OSError) as exc:
            if self._killed:
                raise ConversionCancelled("Conversion stopped by the client") from exc
            self._reset("worker died mid-job")
            raise WorkerCrashed(
                "Conversion worker exited unexpectedly (it may have run out of memory)"
            ) from exc
        if not isinstance(reply, dict) or not reply.get("ok"):
            detail = (reply or {}).get("error") if isinstance(reply, dict) else None
            raise RuntimeError(detail or "conversion failed in worker")
        return reply["result"]

    def kill(self, reason: str) -> bool:
        """Terminate the child so a blocked ``run`` returns now.

        Logs the outcome rather than the intent: a "stopping..." line proves
        nothing, so report the pid, how it died, and whether it is really gone.
        """
        with self._lock:
            self._killed = True
            proc = self._proc
            if proc is None:
                logger.info("Nothing to stop: worker %s has no process (%s)", self.index, reason)
                return False
            pid = proc.pid
            if not proc.is_alive():
                logger.info(
                    "Worker pid=%s had already exited (code=%s) before stop (%s)",
                    pid,
                    proc.exitcode,
                    reason,
                )
                self._close_locked()
                return False

            started = time.monotonic()
            logger.warning("Stopping conversion worker pid=%s: %s (SIGTERM)", pid, reason)
            proc.terminate()
            proc.join(timeout=_KILL_JOIN_S)
            escalated = False
            if proc.is_alive():
                escalated = True
                logger.warning(
                    "Worker pid=%s still alive %.1fs after SIGTERM; escalating to SIGKILL",
                    pid,
                    time.monotonic() - started,
                )
                proc.kill()
                proc.join(timeout=_KILL_JOIN_S)

            elapsed = time.monotonic() - started
            if proc.is_alive():
                # Should not happen; surface it loudly rather than claim success.
                logger.error(
                    "STOP FAILED: worker pid=%s survived SIGKILL after %.1fs — "
                    "it may still be consuming CPU (%s)",
                    pid,
                    elapsed,
                    reason,
                )
                self._close_locked()
                return False

            logger.warning(
                "STOP CONFIRMED: worker pid=%s is gone (exit=%s, signal=%s, took %.2fs) — %s",
                pid,
                proc.exitcode,
                "SIGKILL" if escalated else "SIGTERM",
                elapsed,
                reason,
            )
            self._close_locked()
            logger.info("Next conversion will start a fresh worker and reload models")
            return True

    def shutdown(self) -> None:
        with self._lock:
            proc, conn = self._proc, self._conn
            if conn is not None:
                try:
                    conn.send(_SHUTDOWN)
                except (BrokenPipeError, OSError):
                    pass
            if proc is not None and proc.is_alive():
                proc.join(timeout=2)
                if proc.is_alive():
                    proc.terminate()
                    proc.join(timeout=_KILL_JOIN_S)
            self._close_locked()

    def _reset(self, reason: str) -> None:
        logger.warning("Resetting conversion worker: %s", reason)
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except OSError:
                pass
        self._conn = None
        self._proc = None


class WorkerPool:
    """A fixed set of workers; one conversion each."""

    def __init__(self, settings: Settings, size: int) -> None:
        self.size = max(1, int(size))
        self._idle: queue.LifoQueue[ConversionWorker] = queue.LifoQueue()
        for index in range(self.size):
            self._idle.put(ConversionWorker(settings, index=index))

    def acquire(self, timeout: float = 30.0) -> ConversionWorker:
        try:
            return self._idle.get(timeout=timeout)
        except queue.Empty as exc:  # pragma: no cover - gate bounds entry first
            raise WorkerCrashed("no conversion worker available") from exc

    def release(self, worker: ConversionWorker) -> None:
        self._idle.put(worker)

    def shutdown(self) -> None:
        while True:
            try:
                self._idle.get_nowait().shutdown()
            except queue.Empty:
                return


_pool: WorkerPool | None = None
_pool_lock = threading.Lock()


def get_worker_pool() -> WorkerPool:
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                settings = get_settings()
                _pool = WorkerPool(settings, size=settings.convert_max_concurrent)
    return _pool


def shutdown_worker_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.shutdown()
            _pool = None
