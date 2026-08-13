"""Entry point: build context and drive a level-based Rich menu.

Interactive flow:

    account → environment (local / staging / prod / …) → layer (db, infra, …) → action
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Callable
from dataclasses import dataclass

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

BACK = "__back__"
QUIT = "__quit__"
SKIP_ACCOUNT = "__skip__"
LOCAL_SCOPE = "local"
CLOUD_SCOPE = "cloud"
LOCAL_ENV_TOKENS = {"local", "localhost"}


@dataclass(frozen=True)
class MenuAction:
    key: str
    label: str
    hint: str
    handler: Handler
    needs_aws: bool
    category: str
    scopes: frozenset[str]


@dataclass(frozen=True)
class Category:
    key: str
    label: str
    hint: str
    scopes: frozenset[str]


CATEGORIES: tuple[Category, ...] = (
    Category("stack", "Stack", "Docker Compose (API + UI + Postgres)", frozenset({LOCAL_SCOPE})),
    Category("native", "Native", "uv + Next.js without Docker", frozenset({LOCAL_SCOPE})),
    Category("database", "Database", "Alembic migrations", frozenset({LOCAL_SCOPE, CLOUD_SCOPE})),
    Category("infra", "Infra", "IAM, Terraform, Lambda, ECR", frozenset({CLOUD_SCOPE})),
    Category("frontend", "Frontend", "Cloudflare Pages", frozenset({CLOUD_SCOPE})),
    Category("secrets", "Secrets", "Seed from backend/.env", frozenset({CLOUD_SCOPE})),
)


def _actions() -> tuple[MenuAction, ...]:
    return (
        MenuAction("compose-up", "Compose up --build", "Postgres + API + UI", compose.up, False, "stack", frozenset({LOCAL_SCOPE})),
        MenuAction(
            "compose-up-d",
            "Compose up --build -d",
            "detached",
            lambda ctx: compose.up(ctx, detach=True),
            False,
            "stack",
            frozenset({LOCAL_SCOPE}),
        ),
        MenuAction("compose-down", "Compose down", "", compose.down, False, "stack", frozenset({LOCAL_SCOPE})),
        MenuAction("compose-logs", "Compose logs -f", "", compose.logs, False, "stack", frozenset({LOCAL_SCOPE})),
        MenuAction("compose-ps", "Compose ps", "", compose.ps, False, "stack", frozenset({LOCAL_SCOPE})),
        MenuAction("dev", "Native dev", "API :8000 + UI :3000", local.native_dev, False, "native", frozenset({LOCAL_SCOPE})),
        MenuAction("sync", "Sync deps", "uv + npm", local.sync, False, "native", frozenset({LOCAL_SCOPE})),
        MenuAction("db-upgrade", "Upgrade", "alembic upgrade head", db.upgrade, False, "database", frozenset({LOCAL_SCOPE, CLOUD_SCOPE})),
        MenuAction("db-current", "Current revision", "", db.current, False, "database", frozenset({LOCAL_SCOPE, CLOUD_SCOPE})),
        MenuAction("db-history", "History", "", db.history, False, "database", frozenset({LOCAL_SCOPE, CLOUD_SCOPE})),
        MenuAction("db-revision", "New revision", "autogenerate", db.revision, False, "database", frozenset({LOCAL_SCOPE, CLOUD_SCOPE})),
        MenuAction("db-downgrade", "Downgrade", "", db.downgrade, False, "database", frozenset({LOCAL_SCOPE, CLOUD_SCOPE})),
        MenuAction("check", "Check AWS permissions", "", cloud.check, True, "infra", frozenset({CLOUD_SCOPE})),
        MenuAction("attach-policy", "Attach deploy IAM policy", "", cloud.attach_policy, True, "infra", frozenset({CLOUD_SCOPE})),
        MenuAction("bootstrap", "Bootstrap Terraform state bucket", "", cloud.bootstrap, True, "infra", frozenset({CLOUD_SCOPE})),
        MenuAction("push-image", "Build & push Lambda image", "", cloud.push_image, True, "infra", frozenset({CLOUD_SCOPE})),
        MenuAction("plan", "Terraform plan", "", cloud.plan, True, "infra", frozenset({CLOUD_SCOPE})),
        MenuAction("apply", "Terraform apply", "", cloud.apply, True, "infra", frozenset({CLOUD_SCOPE})),
        MenuAction("full", "Full deploy", "image + apply + secrets + UI", cloud.full, True, "infra", frozenset({CLOUD_SCOPE})),
        MenuAction("status", "Show URLs / health", "", cloud.status, True, "infra", frozenset({CLOUD_SCOPE})),
        MenuAction("destroy", "Destroy this environment", "", cloud.destroy, True, "infra", frozenset({CLOUD_SCOPE})),
        MenuAction("frontend", "Publish frontend", "Cloudflare Pages", cloud.frontend, True, "frontend", frozenset({CLOUD_SCOPE})),
        MenuAction("seed-secrets", "Seed secrets from backend/.env", "", cloud.seed_secrets, True, "secrets", frozenset({CLOUD_SCOPE})),
    )


def _action_by_key() -> dict[str, MenuAction]:
    return {action.key: action for action in _actions()}


def _choose_profile(preselected: str | None, *, allow_skip: bool = False) -> str | None:
    if preselected is not None:
        return preselected or None
    profiles = session_mod.list_profiles()
    choices: list[console.Choice] = []
    if allow_skip:
        choices.append(console.Choice(SKIP_ACCOUNT, "Skip for now", "local work — sign in later if needed"))
    choices.append(
        console.Choice("__default__", "Default credentials", "env vars / default profile")
    )
    for name in profiles:
        choices.append(console.Choice(name, name))
    choices.append(console.Choice("__manual__", "Enter profile name manually"))
    choices.append(console.Choice(QUIT, "Quit"))
    default = SKIP_ACCOUNT if allow_skip else "__default__"
    key = console.select("Choose account", choices, default=default)
    if key == QUIT:
        console.info("Bye.")
        raise SystemExit(0)
    if key == SKIP_ACCOUNT:
        return SKIP_ACCOUNT
    if key == "__default__":
        return None
    if key == "__manual__":
        return console.ask_text("AWS profile name") or None
    return key


def _establish_session(ctx: Context, preselected_profile: str | None, *, allow_skip: bool = False) -> bool:
    """Return False if the operator skipped signing in."""
    while True:
        profile = _choose_profile(preselected_profile, allow_skip=allow_skip)
        preselected_profile = None
        allow_skip = False
        if profile == SKIP_ACCOUNT:
            return False
        session, err = session_mod.try_build_session(profile, ctx.region)
        if session is not None:
            ctx.session = session
            ctx.region = session.region
            console.success(
                f"Authenticated as {session.arn} (account {session.account_id})."
            )
            return True
        console.error(f"Could not use that profile: {err}")
        if not console.confirm("Try a different profile?", default=True):
            raise SystemExit(1)


def _ensure_session(ctx: Context) -> None:
    if ctx.session is None:
        if not _establish_session(ctx, None):
            raise CommandError("This action needs an AWS account.")


def _choose_cloud_environment(default: Environment) -> Environment:
    choices = [
        console.Choice(env.name, _env_label(env.name), env.prefix) for env in ENVIRONMENTS.values()
    ]
    key = console.select("Choose environment", choices, default=default.name)
    return ENVIRONMENTS[key]


def _env_label(name: str) -> str:
    return {
        "local": "Local",
        "dev": "Dev",
        "staging": "Staging",
        "prod": "Prod",
    }.get(name, name)


def _banner(ctx: Context, *, scope: str | None = None, category: str | None = None) -> None:
    session_label = ctx.session.profile_label if ctx.session else "not signed in"
    account = ctx.session.account_id if ctx.session else "-"
    env = "local" if scope == LOCAL_SCOPE else ctx.env.name
    parts = [
        f"account={account}",
        f"profile={session_label}",
        f"env={env}",
        f"region={ctx.region}",
    ]
    if category:
        label = next((item.label for item in CATEGORIES if item.key == category), category)
        parts.append(f"layer={label.lower()}")
    console.blank()
    console.header("FileWorks", "  →  ".join(parts))


def _run(ctx: Context, action: MenuAction) -> None:
    if action.needs_aws:
        _ensure_session(ctx)
    try:
        action.handler(ctx)
    except KeyboardInterrupt:
        console.blank()
        console.warn("Interrupted; returning to menu.")
    except CommandError as exc:
        console.error(str(exc))
    except Exception as exc:  # keep the TUI alive on unexpected failures
        console.error(f"Action failed: {exc}")


def _choose_environment_level(ctx: Context, *, default_scope: str, default_env: Environment) -> tuple[str, str] | None:
    """Return (scope, env_name) or None to go back to account. Raises SystemExit on quit."""
    choices = [
        console.Choice("local", "Local", "Docker Compose / native / local Postgres"),
        console.Choice("dev", "Dev", "AWS + Cloudflare (fileworks-dev)"),
        console.Choice("staging", "Staging", "AWS + Cloudflare (fileworks-staging)"),
        console.Choice("prod", "Prod", "AWS + Cloudflare (fileworks-prod)"),
        console.Choice(BACK, "Back", "choose account"),
        console.Choice(QUIT, "Quit"),
    ]
    default = "local" if default_scope == LOCAL_SCOPE else default_env.name
    key = console.select("Choose environment", choices, default=default)
    if key == QUIT:
        console.info("Bye.")
        raise SystemExit(0)
    if key == BACK:
        return None
    if key == "local":
        return LOCAL_SCOPE, "local"
    ctx.env = ENVIRONMENTS[key]
    _ensure_session(ctx)
    return CLOUD_SCOPE, key


def _choose_category_level(scope: str) -> str:
    choices = [
        console.Choice(item.key, item.label, item.hint)
        for item in CATEGORIES
        if scope in item.scopes
    ]
    choices.append(console.Choice(BACK, "Back", "choose environment"))
    choices.append(console.Choice(QUIT, "Quit"))
    default = choices[0].key if choices else BACK
    return console.select("Choose layer", choices, default=default)


def _choose_action_level(scope: str, category: str) -> str:
    actions = [item for item in _actions() if item.category == category and scope in item.scopes]
    choices = [console.Choice(item.key, item.label, item.hint) for item in actions]
    choices.append(console.Choice(BACK, "Back", "choose layer"))
    choices.append(console.Choice(QUIT, "Quit"))
    default = actions[0].key if actions else BACK
    return console.select("Choose action", choices, default=default)


def _menu(
    ctx: Context,
    *,
    start_at: str = "account",
    initial_scope: str = LOCAL_SCOPE,
) -> None:
    """Nested menus. ``start_at`` is account | environment | layer."""
    catalog = _action_by_key()
    scope = initial_scope
    level = start_at
    category = ""

    while True:
        if level == "account":
            signed_in = _establish_session(ctx, None, allow_skip=True)
            if not signed_in:
                scope = LOCAL_SCOPE
            level = "environment"
            continue

        if level == "environment":
            _banner(ctx, scope=scope)
            picked = _choose_environment_level(ctx, default_scope=scope, default_env=ctx.env)
            if picked is None:
                level = "account"
                continue
            scope, _env_name = picked
            level = "layer"
            continue

        if level == "layer":
            _banner(ctx, scope=scope)
            category = _choose_category_level(scope)
            if category == QUIT:
                console.info("Bye.")
                return
            if category == BACK:
                level = "environment"
                continue
            level = "action"
            continue

        _banner(ctx, scope=scope, category=category)
        selection = _choose_action_level(scope, category)
        if selection == QUIT:
            console.info("Bye.")
            return
        if selection == BACK:
            level = "layer"
            continue
        _run(ctx, catalog[selection])


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="fw",
        description="Interactive FileWorks operator TUI (account → environment → layer → action).",
    )
    parser.add_argument(
        "action",
        nargs="?",
        choices=[action.key for action in _actions()],
        help="Skip the menu and run one action.",
    )
    parser.add_argument("--profile", help="AWS profile (skips the account prompt).")
    parser.add_argument("--env", help="Environment: local, dev, staging, or prod.")
    parser.add_argument("--region", help=f"AWS region (default: {DEFAULT_REGION}).")
    parser.add_argument("--yes", action="store_true", help="Skip apply confirmation.")
    parser.add_argument("--version", action="version", version=f"fw {__version__}")
    return parser.parse_args(argv)


def _parse_env_flag(token: str | None) -> tuple[str | None, Environment | None]:
    """Return (scope, cloud env). scope is local/cloud/None if unset."""
    if not token:
        return None, None
    lowered = token.strip().lower()
    if lowered in LOCAL_ENV_TOKENS:
        return LOCAL_SCOPE, None
    resolved = resolve_environment(token)
    if resolved is None:
        return None, None
    return CLOUD_SCOPE, resolved


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    scope, cloud_env = _parse_env_flag(args.env)
    if args.env and scope is None:
        console.error(f"Unknown environment: {args.env}")
        return 2
    default_env = cloud_env or ENVIRONMENTS["dev"]
    region = args.region or DEFAULT_REGION
    ctx = Context(env=default_env, region=region, auto_yes=args.yes)

    console.header("FileWorks", "account  →  environment  →  layer  →  action")

    try:
        if args.action:
            action = _action_by_key()[args.action]
            if action.needs_aws:
                _establish_session(ctx, args.profile)
                if cloud_env is None:
                    ctx.env = _choose_cloud_environment(ctx.env)
                else:
                    ctx.env = cloud_env
            elif cloud_env is not None:
                ctx.env = cloud_env
            action.handler(ctx)
            return 0

        if args.profile is not None:
            _establish_session(ctx, args.profile)
        if cloud_env is not None:
            ctx.env = cloud_env

        if scope is not None:
            start_at = "layer"
        elif args.profile is not None:
            start_at = "environment"
        else:
            start_at = "account"

        _menu(ctx, start_at=start_at, initial_scope=scope or LOCAL_SCOPE)
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
