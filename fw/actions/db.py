"""Alembic migrations against local (or configured) Postgres."""

from __future__ import annotations

import os

from fw import console
from fw.context import BACKEND_DIR, DEFAULT_DATABASE_URL, Context
from fw.tools import require_cmd, run


def _db_env() -> dict[str, str]:
    extra: dict[str, str] = {}
    if not os.environ.get("DATABASE_URL"):
        extra["DATABASE_URL"] = DEFAULT_DATABASE_URL
    return extra


def _alembic(ctx: Context, args: list[str]) -> None:
    require_cmd("uv")
    run(
        ["uv", "run", "python", "-m", "app.db.upgrade", *args],
        cwd=BACKEND_DIR,
        env=_db_env() or None,
        ctx=ctx,
    )


def upgrade(ctx: Context) -> None:
    console.rule("Database upgrade")
    console.kv_table(
        "Migration",
        [
            ("Command", "alembic upgrade head"),
            ("DATABASE_URL", os.environ.get("DATABASE_URL") or DEFAULT_DATABASE_URL),
        ],
    )
    if not ctx.auto_yes and not console.confirm("Apply pending migrations?", default=True):
        console.warn("Cancelled.")
        return
    _alembic(ctx, ["upgrade"])
    console.success("Migrations applied.")


def current(ctx: Context) -> None:
    console.rule("Database current")
    _alembic(ctx, ["current"])


def history(ctx: Context) -> None:
    console.rule("Database history")
    _alembic(ctx, ["history"])


def downgrade(ctx: Context) -> None:
    console.rule("Database downgrade")
    revision = console.ask_text("Target revision", default="-1")
    if not console.confirm(f"Downgrade to {revision}?", default=False):
        console.warn("Cancelled.")
        return
    _alembic(ctx, ["downgrade", revision])
    console.success(f"Downgraded to {revision}.")


def revision(ctx: Context) -> None:
    console.rule("New Alembic revision")
    message = console.ask_text("Revision message")
    if not message.strip():
        console.error("Message is required.")
        return
    autogen = console.confirm("Autogenerate from models?", default=True)
    args = ["revision", "-m", message.strip()]
    if autogen:
        args.append("--autogenerate")
    _alembic(ctx, args)
    console.success("Revision file written under backend/app/db/migrations/versions/.")
