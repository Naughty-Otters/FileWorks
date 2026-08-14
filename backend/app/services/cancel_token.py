"""Cooperative cancel tokens for work that cannot be SIGKILL'd.

Local conversions run in a child process we can terminate. Lambda invocations
cannot be stopped from the outside — AWS has no cancel API — so Stop writes a
tombstone and the worker checks it between pages and exits early.

Storage (must be visible to every process that might be doing the work):
- S3 history bucket ``cancel/{run_id}`` when ``storage_backend=s3`` — shared by
  the API Lambda and the LLM Lambda.
- A file under ``upload_dir/cancel/{run_id}`` otherwise — parent and child
  processes on the same machine both see it (an in-memory dict would not).
"""

from __future__ import annotations

import contextlib
import contextvars
import json
import logging
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from app.services.worker import ConversionCancelled

logger = logging.getLogger(__name__)

CANCEL_PREFIX = "cancel"
_current_run_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "cancel_run_id", default=None
)
# In-memory mirror for tests that call reset_local_tokens(); production local
# mode always also writes a file so the subprocess can see it.
_local_tokens: dict[str, dict[str, Any]] = {}
_local_lock = threading.Lock()


def active_run_id() -> str | None:
    return _current_run_id.get()


@contextlib.contextmanager
def cancel_scope(run_id: str | None) -> Iterator[None]:
    """Bind ``run_id`` for the current task so page loops can find it."""
    token = _current_run_id.set(str(run_id).strip() or None if run_id else None)
    try:
        yield
    finally:
        _current_run_id.reset(token)


def cancel_key(run_id: str) -> str:
    return f"{CANCEL_PREFIX}/{run_id}"


def mark_cancelled(
    run_id: str,
    *,
    owner: str | None = None,
    reason: str = "stopped by the client",
) -> bool:
    """Write a cancel tombstone. Returns True when the write succeeded."""
    rid = str(run_id or "").strip()
    if not rid:
        return False
    payload = {
        "run_id": rid,
        "cancelled": True,
        "reason": reason,
        "owner": owner,
        "at": time.time(),
    }
    if _use_s3():
        return _mark_s3(rid, payload)
    return _mark_local(rid, payload)


def is_cancelled(run_id: str | None = None) -> bool:
    """True when a Stop tombstone exists for this run."""
    rid = str(run_id or active_run_id() or "").strip()
    if not rid:
        return False
    if _use_s3():
        return _check_s3(rid)
    return _check_local(rid)


def check_cancelled(run_id: str | None = None, *, where: str = "") -> None:
    """Raise :class:`ConversionCancelled` if this run was stopped."""
    rid = str(run_id or active_run_id() or "").strip()
    if not rid or not is_cancelled(rid):
        return
    place = f" at {where}" if where else ""
    message = f"Conversion stopped by the client{place}"
    logger.warning("CANCELLED run=%s%s — leaving early", rid, place)
    raise ConversionCancelled(message)


def clear_cancelled(run_id: str) -> None:
    """Drop a tombstone (tests / successful completion)."""
    rid = str(run_id or "").strip()
    if not rid:
        return
    if _use_s3():
        _clear_s3(rid)
        return
    with _local_lock:
        _local_tokens.pop(rid, None)
    path = _local_token_path(rid)
    if path is not None:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass


def reset_local_tokens() -> None:
    """Forget every in-memory and on-disk local tombstone (tests)."""
    with _local_lock:
        ids = list(_local_tokens)
        _local_tokens.clear()
    root = _local_cancel_dir()
    for rid in ids:
        path = root / rid if root is not None else None
        if path is not None:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
    if root is not None and root.is_dir():
        for path in root.glob("*"):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass


def _use_s3() -> bool:
    from app.core.config import get_settings

    settings = get_settings()
    return settings.storage_backend.lower() == "s3" and bool(settings.s3_bucket)


def _local_cancel_dir() -> Path | None:
    from app.core.config import get_settings

    settings = get_settings()
    try:
        root = Path(settings.upload_dir) / CANCEL_PREFIX
        root.mkdir(parents=True, exist_ok=True)
        return root
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not create local cancel dir: %s", exc)
        return None


def _local_token_path(run_id: str) -> Path | None:
    root = _local_cancel_dir()
    if root is None:
        return None
    # run_id is a client UUID hex; keep the path name simple.
    safe = "".join(ch for ch in run_id if ch.isalnum() or ch in "-_")
    if not safe:
        return None
    return root / safe


def _mark_local(run_id: str, payload: dict[str, Any]) -> bool:
    with _local_lock:
        _local_tokens[run_id] = payload
    path = _local_token_path(run_id)
    if path is not None:
        try:
            path.write_text(json.dumps(payload), encoding="utf-8")
        except OSError as exc:
            logger.error("Failed to write cancel token file %s: %s", path, exc)
            # Memory still set in this process; child will not see it.
            return True
        logger.warning(
            "CANCEL TOKEN written (file) path=%s reason=%s",
            path,
            payload.get("reason"),
        )
        return True
    logger.warning(
        "CANCEL TOKEN written (memory-only) run=%s reason=%s — child process cannot see it",
        run_id,
        payload.get("reason"),
    )
    return True


def _check_local(run_id: str) -> bool:
    with _local_lock:
        if run_id in _local_tokens:
            return True
    path = _local_token_path(run_id)
    if path is None:
        return False
    try:
        return path.is_file()
    except OSError:
        return False


def _mark_s3(run_id: str, payload: dict[str, Any]) -> bool:
    from app.core.config import get_settings

    settings = get_settings()
    bucket = settings.s3_bucket
    assert bucket
    key = cancel_key(run_id)
    try:
        import boto3

        boto3.client("s3", region_name=settings.s3_region).put_object(
            Bucket=bucket,
            Key=key,
            Body=json.dumps(payload).encode("utf-8"),
            ContentType="application/json",
        )
    except Exception as exc:  # noqa: BLE001
        logger.error("Failed to write cancel token s3://%s/%s: %s", bucket, key, exc)
        return False
    logger.warning(
        "CANCEL TOKEN written s3://%s/%s reason=%s",
        bucket,
        key,
        payload.get("reason"),
    )
    return True


def _check_s3(run_id: str) -> bool:
    from app.core.config import get_settings

    settings = get_settings()
    bucket = settings.s3_bucket
    assert bucket
    key = cancel_key(run_id)
    try:
        import boto3
        from botocore.exceptions import ClientError

        boto3.client("s3", region_name=settings.s3_region).head_object(Bucket=bucket, Key=key)
        return True
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            return False
        logger.warning("Cancel-token head_object failed for %s: %s", key, exc)
        return False
    except Exception as exc:  # noqa: BLE001
        logger.warning("Cancel-token check failed for %s: %s", key, exc)
        return False


def _clear_s3(run_id: str) -> None:
    from app.core.config import get_settings

    settings = get_settings()
    bucket = settings.s3_bucket
    if not bucket:
        return
    try:
        import boto3

        boto3.client("s3", region_name=settings.s3_region).delete_object(
            Bucket=bucket, Key=cancel_key(run_id)
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not clear cancel token %s: %s", run_id, exc)
