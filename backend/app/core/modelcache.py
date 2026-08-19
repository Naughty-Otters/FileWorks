"""Point runtime caches at writable /tmp while reading baked /var/task weights.

Lambda mounts ``/var/task`` read-only. PaddleX / HuggingFace still mkdir lock
dirs inside the cache home, so ``PADDLE_PDX_CACHE_HOME=/var/task/.cache/...``
fails with ``[Errno 30] Read-only file system``. Compose can write the image
FS, so this is a no-op there.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)

BAKED_CACHE = Path("/var/task/.cache")
RUNTIME_CACHE = Path("/tmp/fw-models")
_WEIGHT_LINKS = (
    "paddlex/official_models",
    "docling",
    "huggingface",
    "easyocr",
)


def _task_cache_is_writable() -> bool:
    if not BAKED_CACHE.is_dir():
        return True
    probe = BAKED_CACHE / ".fw-write-probe"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except OSError:
        return False


def hydrate_baked_model_cache() -> None:
    if _task_cache_is_writable():
        return
    for rel in _WEIGHT_LINKS:
        src = BAKED_CACHE / rel
        dst = RUNTIME_CACHE / rel
        if not src.exists():
            continue
        dst.parent.mkdir(parents=True, exist_ok=True)
        if dst.exists() or dst.is_symlink():
            continue
        dst.symlink_to(src)
    (RUNTIME_CACHE / "paddlex").mkdir(parents=True, exist_ok=True)
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(RUNTIME_CACHE / "paddlex")
    os.environ["HF_HOME"] = str(RUNTIME_CACHE / "huggingface")
    logger.info(
        "Model caches remapped to %s (Lambda /var/task is read-only)",
        RUNTIME_CACHE,
    )
