"""Entry point: build context and drive the interactive Rich menu."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable

from fw import __version__, console
from fw.actions import cloud, compose, db, local
from fw.aws import session as session_mod
from fw.context import (
    DEFAULT_REGION,
    ENVIRONMENTS,
    Context,
    Environment,
    resolve_environment,
)
from fw.tools import CommandError

Handler = Callable[[Context], None]


def _choose_profile(preselected: str | None) -> str | None:
    if preselected is not None:
        return preselected or None
    profiles = session_mod.list_profiles()
    choices = [
        console.Choice("__default__", "Default credentials", "env vars / default profile")
    ]
    for name in profiles:
        choices.append(console.Choice(name, name))
    choices.append(console.Choice("__manual__", "Enter profile name manually"))
    key = console.select("Select AWS profile", choices, default="__default__")
    if key == "__default__":
        return None
    if key == "__manual__":
        return console.ask_text("AWS profile name") or None
    return key


def _establish_session(ctx: Context, preselected_profile: str | None) -> None:
    while True:
        profile = _choose_profile(preselected_profile)
        preselected_profile = None
        session, err = session_mod.try_build_session(profile, ctx.region)
        if session is not None:
            ctx.session = session
            ctx.region = session.region
            console.success(
                f"Authenticated as {session.arn} (account {session.account_id})."
            )
            return
        console.error(f"Could not use that profile: {err}")
        if not console.confirm("Try a different profile?", default=True):
            raise SystemExit(1)


def _ensure_session(ctx: Context) -> None:
    if ctx.session is None:
        _establish_session(ctx, None)


def _choose_environment(default: Environment) -> Environment:
    choices = [
        console.Choice(env.name, env.name, env.prefix) for env in ENVIRONMENTS.values()
    ]
    key = console.select("Select environment", choices, default=default.name)
    return ENVIRONMENTS[key]


def _actions() -> list[tuple[str, str, str, Handler, bool]]:
    """key, label, hint, handler, needs_aws."""
    return [
        ("compose-up", "Compose up --build", "Postgres + API + UI", compose.up, False),
        ("compose-up-d", "Compose up --build -d", "detached", lambda ctx: compose.up(ctx, detach=True), False),
        ("compose-down", "Compose down", "", compose.down, False),
        ("compose-logs", "Compose logs -f", "", compose.logs, False),
        ("compose-ps", "Compose ps", "", compose.ps, False),
        ("dev", "Native dev", "API :8000 + UI :3000", local.native_dev, False),
        ("sync", "Sync deps", "uv + npm", local.sync, False),
        ("db-upgrade", "DB upgrade", "alembic upgrade head", db.upgrade, False),
        ("db-current", "DB current", "", db.current, False),
        ("db-history", "DB history", "", db.history, False),
        ("db-revision", "DB new revision", "autogenerate", db.revision, False),
        ("db-downgrade", "DB downgrade", "", db.downgrade, False),
        ("check", "Check AWS permissions", "", cloud.check, True),
        ("attach-policy", "Attach deploy IAM policy", "", cloud.attach_policy, True),
        ("bootstrap", "Bootstrap Terraform state bucket", "", cloud.bootstrap, True),
        ("push-image", "Build & push Lambda image", "", cloud.push_image, True),
        ("plan", "Terraform plan", "", cloud.plan, True),
        ("apply", "Terraform apply", "", cloud.apply, True),
        ("seed-secrets", "Seed secrets from backend/.env", "", cloud.seed_secrets, True),
        ("frontend", "Publish frontend (Cloudflare Pages)", "", cloud.frontend, True),
        ("full", "Full deploy", "recommended first AWS run", cloud.full, True),
        ("status", "Show URLs / health", "", cloud.status, True),
        ("destroy", "Destroy this environment", "", cloud.destroy, True),
    ]


def _menu(ctx: Context) -> None:
    catalog = {key: (label, hint, handler, needs_aws) for key, label, hint, handler, needs_aws in _actions()}
    while True:
        console.blank()
        session_label = ctx.session.profile_label if ctx.session else "not signed in"
        account = ctx.session.account_id if ctx.session else "-"
        console.header(
            "FileWorks",
            f"profile={session_label}  account={account}  region={ctx.region}  env={ctx.env.name}",
        )
        choices = [
            console.Choice(key, label, hint) for key, label, hint, _, _ in _actions()
        ]
        choices.append(console.Choice("switch_profile", "Switch AWS profile"))
        choices.append(console.Choice("switch_env", "Switch environment"))
        choices.append(console.Choice("quit", "Quit"))

        selection = console.select("Choose an action", choices, default="compose-up")
        if selection == "quit":
            console.info("Bye.")
            return
        if selection == "switch_profile":
            _establish_session(ctx, None)
            continue
        if selection == "switch_env":
            ctx.env = _choose_environment(ctx.env)
            continue

        _, _, handler, needs_aws = catalog[selection]
        if needs_aws:
            _ensure_session(ctx)
        try:
            handler(ctx)
        except KeyboardInterrupt:
            console.blank()
            console.warn("Interrupted; returning to menu.")
        except CommandError as exc:
            console.error(str(exc))
        except Exception as exc:  # keep the TUI alive on unexpected failures
            console.error(f"Action failed: {exc}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="fw",
        description="Interactive FileWorks operator TUI (local, database, AWS + Cloudflare).",
    )
    parser.add_argument(
        "action",
        nargs="?",
        choices=[key for key, *_ in _actions()],
        help="Skip the menu and run one action.",
    )
    parser.add_argument("--profile", help="AWS profile (skips the prompt).")
    parser.add_argument("--env", help="Environment: dev, staging, or prod.")
    parser.add_argument("--region", help=f"AWS region (default: {DEFAULT_REGION}).")
    parser.add_argument("--yes", action="store_true", help="Skip apply confirmation.")
    parser.add_argument("--version", action="version", version=f"fw {__version__}")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    default_env = ENVIRONMENTS["dev"]
    if args.env:
        resolved = resolve_environment(args.env)
        if resolved is None:
            console.error(f"Unknown environment: {args.env}")
            return 2
        default_env = resolved
    region = args.region or DEFAULT_REGION
    ctx = Context(env=default_env, region=region, auto_yes=args.yes)

    console.header("FileWorks", "local stack · database · AWS Lambda · Cloudflare Pages")

    try:
        if args.action:
            catalog = {key: (handler, needs_aws) for key, _, _, handler, needs_aws in _actions()}
            handler, needs_aws = catalog[args.action]
            if needs_aws:
                _establish_session(ctx, args.profile)
                if not args.env:
                    ctx.env = _choose_environment(ctx.env)
            handler(ctx)
            return 0

        if args.profile is not None:
            _establish_session(ctx, args.profile)
        if args.env:
            ctx.env = default_env
        _menu(ctx)
    except KeyboardInterrupt:
        console.blank()
        console.info("Cancelled.")
        return 130
    except CommandError as exc:
        console.error(str(exc))
        return exc.code
    return 0


if __name__ == "__main__":
    sys.exit(main())
