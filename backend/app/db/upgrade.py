"""Apply (and generate) Postgres schema migrations.

Usage::

    uv run python -m app.db.upgrade
    uv run python -m app.db.upgrade current
    uv run python -m app.db.upgrade revision -m "add column" --autogenerate
    uv run python -m app.db.upgrade downgrade -1
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config

logger = logging.getLogger(__name__)

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"


def alembic_config(database_url: str | None = None) -> Config:
    from app.core.config import get_settings

    url = database_url if database_url is not None else get_settings().database_url
    if not url:
        raise RuntimeError("DATABASE_URL is not set")
    cfg = Config(str(ALEMBIC_INI) if ALEMBIC_INI.is_file() else None)
    cfg.set_main_option("script_location", str(MIGRATIONS_DIR))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
    cfg.set_main_option("prepend_sys_path", ".")
    return cfg


def upgrade_db(revision: str = "head") -> None:
    from app.core.config import get_settings

    if not get_settings().database_url:
        logger.info("DATABASE_URL unset — skipping migrations")
        return
    cfg = alembic_config()
    command.upgrade(cfg, revision)
    logger.info("Database migrated to %s", revision)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )
    parser = argparse.ArgumentParser(description="FileWorks database migrations")
    sub = parser.add_subparsers(dest="cmd")
    sub.required = False

    up = sub.add_parser("upgrade", help="Apply migrations (default)")
    up.add_argument("revision", nargs="?", default="head")
    parser.set_defaults(cmd="upgrade", revision="head")

    down = sub.add_parser("downgrade", help="Roll back to a revision (e.g. -1 or 0001_initial_auth)")
    down.add_argument("revision", nargs="?", default="-1")

    sub.add_parser("current", help="Show the current revision")
    sub.add_parser("history", help="List revisions")

    rev = sub.add_parser("revision", help="Create a new migration file")
    rev.add_argument("-m", "--message", required=True)
    rev.add_argument("--autogenerate", action="store_true")

    args = parser.parse_args(argv)
    cmd = args.cmd or "upgrade"
    try:
        if cmd == "upgrade":
            upgrade_db(getattr(args, "revision", "head"))
        elif cmd == "downgrade":
            command.downgrade(alembic_config(), args.revision)
        elif cmd == "current":
            command.current(alembic_config())
        elif cmd == "history":
            command.history(alembic_config())
        elif cmd == "revision":
            command.revision(
                alembic_config(),
                message=args.message,
                autogenerate=args.autogenerate,
            )
        else:
            parser.error(f"unknown command {cmd}")
    except RuntimeError as exc:
        logger.error("%s", exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
