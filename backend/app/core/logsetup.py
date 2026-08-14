"""App logs that survive uvicorn, Docker, Lambda, and Alembic.

Two things silence ``app.*`` INFO if left alone:

1. Uvicorn's dictConfig only attaches handlers to ``uvicorn`` /
   ``uvicorn.access``. Root gets none, and Python's lastResort is WARNING+.
2. Alembic's ``fileConfig`` (run on every migration) sets ``disabled = True``
   on every logger missing from ``alembic.ini`` — including ``app.*``.

So: register ``app`` in the same config uvicorn uses, and re-enable ``app.*``
whenever we configure. One path only — ``logger.info``, no ``print``.
"""

from __future__ import annotations

import copy
import logging
import logging.config
from typing import Any

_APP_LOGGER = {
    "handlers": ["default"],
    "level": "INFO",
    "propagate": False,
}


def logging_config() -> dict[str, Any]:
    """Uvicorn's config plus an ``app`` logger on the same stderr handler."""
    try:
        from uvicorn.config import LOGGING_CONFIG
    except ImportError:  # pragma: no cover
        return {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {"default": {"format": "%(levelname)s %(message)s"}},
            "handlers": {
                "default": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "stream": "ext://sys.stderr",
                }
            },
            "loggers": {"app": dict(_APP_LOGGER)},
        }
    config = copy.deepcopy(LOGGING_CONFIG)
    config["disable_existing_loggers"] = False
    loggers = config.setdefault("loggers", {})
    loggers["app"] = dict(_APP_LOGGER)
    return config


def enable_app_loggers() -> None:
    """Undo ``disable_existing_loggers`` on ``app`` and every ``app.*`` child."""
    app_log = logging.getLogger("app")
    app_log.disabled = False
    for name, existing in list(logging.Logger.manager.loggerDict.items()):
        if isinstance(existing, logging.Logger) and name.startswith("app."):
            existing.disabled = False


def configure_app_logging() -> None:
    """Install the config. Safe to call again after uvicorn or Alembic reconfigure."""
    logging.config.dictConfig(logging_config())
    app_log = logging.getLogger("app")
    app_log.setLevel(logging.INFO)
    app_log.propagate = False
    enable_app_loggers()


def emit(message: str, *, logger: logging.Logger | None = None) -> None:
    """One convert line via logging (assertLogs in tests)."""
    target = logger or logging.getLogger("app")
    if target.disabled or logging.getLogger("app").disabled:
        enable_app_loggers()
    target.info("%s", message)


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
        prefer = bool(
            options.get("prefer_structure") is True or options.get("prefer_structure") == "true"
        )
    extras.append("prefer_structure=true" if prefer else "prefer_structure=false")
    if via:
        extras.append(f"via={via}")
    extra = f" {' '.join(extras)}" if extras else ""
    emit(
        f"Using engine={engine_id} provider={provider} file={filename} pages={page_count}{extra}",
        logger=logger,
    )
