"""Process entrypoint: ``python -m app``.

Passes FileWorks log config into uvicorn so ``app.*`` INFO is not dropped.
Honor ``PORT`` (Lambda adapter / Compose) and ``UVICORN_RELOAD`` (native dev).
"""

from __future__ import annotations

import os

import uvicorn

from app.core.logsetup import logging_config


def main() -> None:
    port = int(os.environ.get("PORT", "8000"))
    reload_on = os.environ.get("UVICORN_RELOAD", "").strip().lower() in {"1", "true", "yes"}
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=port,
        log_config=logging_config(),
        log_level="info",
        reload=reload_on,
    )


if __name__ == "__main__":
    main()
