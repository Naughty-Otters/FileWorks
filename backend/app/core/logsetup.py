"""Make convert logs visible under uvicorn, Docker, and Lambda (stderr)."""

from __future__ import annotations

import logging
import sys
from typing import Any

_CONFIGURED = False


def configure_app_logging() -> None:
    """Keep app logs at INFO. Emit convert lines on stderr (see ``emit``)."""
    global _CONFIGURED
    logging.getLogger().setLevel(logging.INFO)
    logging.getLogger("app").setLevel(logging.INFO)
    if _CONFIGURED:
        return
    _CONFIGURED = True


def emit(message: str, *, logger: logging.Logger | None = None) -> None:
    """One stderr line. Also logger.info so unit tests can assertLogs."""
    print(message, file=sys.stderr, flush=True)
    if logger is not None:
        logger.info("%s", message)


def log_used_engine(
    result: Any,
    *,
    filename: str,
    logger: logging.Logger | None = None,
    via: str | None = None,
) -> None:
    if isinstance(result, dict):
        meta = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
        engine_id = result.get("provider") or result.get("engine") or (
            "llm" if via == "remote-lambda" else "unknown"
        )
        page_count = result.get("page_count")
        options = result.get("options")
    else:
        meta = getattr(result, "metadata", None) or {}
        engine_id = getattr(result, "engine_id", None) or "unknown"
        page_count = getattr(result, "page_count", None)
        options = getattr(result, "options", None)
    provider = (meta or {}).get("provider") or engine_id
    extras: list[str] = []
    fmt = (meta or {}).get("format")
    if fmt:
        extras.append(f"format={fmt}")
    if (meta or {}).get("structure_edited"):
        extras.append("structure_edited=true")
    if (meta or {}).get("translated_to"):
        extras.append(f"translated_to={(meta or {}).get('translated_to')}")
    prefer = False
    if isinstance(options, dict):
        prefer = bool(options.get("prefer_structure") is True or options.get("prefer_structure") == "true")
    extras.append("prefer_structure=true" if prefer else "prefer_structure=false")
    if via:
        extras.append(f"via={via}")
    extra = f" {' '.join(extras)}" if extras else ""
    emit(
        f"Using engine={engine_id} provider={provider} file={filename} pages={page_count}{extra}",
        logger=logger,
    )
