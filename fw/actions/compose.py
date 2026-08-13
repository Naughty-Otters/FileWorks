"""Docker Compose local stack."""

from __future__ import annotations

from fw import console
from fw.context import ROOT_DIR, Context
from fw.tools import require_cmd, run


def up(ctx: Context, *, detach: bool = False) -> None:
    require_cmd("docker")
    console.rule("Compose up")
    args = ["docker", "compose", "up", "--build"]
    if detach:
        args.append("-d")
    run(args, cwd=ROOT_DIR, ctx=ctx)
    console.success("UI http://localhost:3000  ·  API http://localhost:8000")


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
