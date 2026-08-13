"""Native local run and dependency sync."""

from __future__ import annotations

import subprocess

from fw import console
from fw.context import BACKEND_DIR, FRONTEND_DIR, Context
from fw.tools import require_cmd, run


def sync(ctx: Context) -> None:
    require_cmd("uv", "npm")
    console.rule("Sync dependencies")
    run(["uv", "sync"], cwd=BACKEND_DIR, ctx=ctx)
    run(["npm", "install"], cwd=FRONTEND_DIR, ctx=ctx)
    console.success("Backend uv sync and frontend npm install finished.")


def native_dev(ctx: Context) -> None:
    require_cmd("uv", "npm")
    console.rule("Native dev")
    console.info("API :8000  ·  UI :3000  (Ctrl-C stops both)")
    api = subprocess.Popen(
        ["uv", "run", "uvicorn", "app.main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"],
        cwd=BACKEND_DIR,
    )
    try:
        subprocess.run(["npm", "run", "dev"], cwd=FRONTEND_DIR, check=False)
    finally:
        api.terminate()
        try:
            api.wait(timeout=8)
        except subprocess.TimeoutExpired:
            api.kill()
