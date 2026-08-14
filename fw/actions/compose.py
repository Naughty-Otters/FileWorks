"""Docker Compose local stack.

Code is bind-mounted (``backend/app``, ``frontend``), so day-to-day ``up``
must not force ``--build``. Rebuild only when the Dockerfile or lockfiles
change (menu: Compose rebuild).
"""

from __future__ import annotations

from fw import console
from fw.context import ROOT_DIR, Context
from fw.tools import require_cmd, run


def up(ctx: Context, *, detach: bool = False, build: bool = False) -> None:
    require_cmd("docker")
    console.rule("Compose up" + (" --build" if build else ""))
    args = ["docker", "compose", "up"]
    if build:
        args.append("--build")
    if detach:
        args.append("-d")
    run(args, cwd=ROOT_DIR, ctx=ctx)
    console.success("UI http://localhost:3000  ·  API http://localhost:8000")


def rebuild(ctx: Context, *, detach: bool = False) -> None:
    """Force image rebuild, then start the stack."""
    up(ctx, detach=detach, build=True)


def down(ctx: Context) -> None:
    require_cmd("docker")
    console.rule("Compose down")
    run(["docker", "compose", "down"], cwd=ROOT_DIR, ctx=ctx)
    console.success("Stack stopped.")


def logs(ctx: Context) -> None:
    require_cmd("docker")
    console.rule("Compose logs")
    run(["docker", "compose", "logs", "-f"], cwd=ROOT_DIR, ctx=ctx)


def ps(ctx: Context) -> None:
    require_cmd("docker")
    console.rule("Compose ps")
    run(["docker", "compose", "ps"], cwd=ROOT_DIR, ctx=ctx)
