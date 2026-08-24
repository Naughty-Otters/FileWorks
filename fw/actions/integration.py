"""Post-deploy Playwright suite (UI + Convert API) against the selected env."""

from __future__ import annotations

import os
from pathlib import Path

from fw import console
from fw.context import INTEGRATION_DIR, Context
from fw.tools import CommandError, require_cmd, run

TEST_MODES = ("all", "smoke", "api", "ui", "convert")

_MODE_HINTS = {
    "all": "Everything: smoke + UI + API (+ convert if FW_API_KEY set)",
    "smoke": "Pages + health + catalog (@smoke)",
    "api": "API project only",
    "ui": "Browser UI project only",
    "convert": "Real convert matrix (@convert — needs FW_API_KEY)",
}


def _is_local(ctx: Context) -> bool:
    return (ctx.scope or "").lower() == "local"


def _fw_env_name(ctx: Context) -> str:
    if _is_local(ctx):
        return "local"
    return ctx.env.name


def _resolve_urls(ctx: Context) -> tuple[str, str]:
    """Return (base_url, api_url) for Playwright FW_BASE_URL / FW_API_URL."""
    if _is_local(ctx):
        return "http://localhost:3000", "http://localhost:8000"

    base = ctx.env.public_origin.rstrip("/")
    api = (ctx.env.api_origin or "").rstrip("/")
    if not api:
        # Dev (and any env without a custom API host): prefer live Terraform output.
        try:
            from fw.context import resolve_public_api_url
            from fw.tools import terraform_output

            outputs = terraform_output(ctx)
            api = resolve_public_api_url(
                os.environ.get("PUBLIC_API_URL", ""),
                ctx.env.api_origin,
                str(outputs.get("api_url") or ""),
                str(outputs.get("lambda_url") or ""),
            ).rstrip("/")
        except Exception:
            api = ""
    if not api:
        # Last resort: integration/.env.<env> or caller-exported FW_API_URL.
        api = (os.environ.get("FW_API_URL") or "").rstrip("/")
    return base, api


def _choose_mode(ctx: Context) -> str:
    raw = (ctx.extras.get("test_mode") or ctx.extras.get("mode") or "").strip().lower()
    if raw in TEST_MODES:
        return raw
    if ctx.auto_yes:
        return "all"
    return console.select(
        "Test mode",
        [console.Choice(key, key, _MODE_HINTS[key]) for key in TEST_MODES],
        default="all",
    )


def _playwright_args(mode: str) -> list[str]:
    if mode == "all":
        return []
    if mode == "smoke":
        return ["--grep", "@smoke"]
    if mode == "api":
        return ["--project=api"]
    if mode == "ui":
        return ["--project=ui"]
    if mode == "convert":
        return ["--grep", "@convert"]
    raise CommandError(f"Unknown test mode: {mode}")


def _ensure_integration_deps(ctx: Context) -> None:
    require_cmd("npm", "npx")
    node_modules = INTEGRATION_DIR / "node_modules" / "@playwright" / "test"
    if not node_modules.is_dir():
        console.info("Installing integration npm deps…")
        run(["npm", "install"], cwd=INTEGRATION_DIR, ctx=ctx)
    # Idempotent; no-ops if Chromium already present.
    run(
        ["npx", "playwright", "install", "chromium"],
        cwd=INTEGRATION_DIR,
        ctx=ctx,
        check=False,
    )


def _dotenv_hint(fw_env: str) -> Path:
    return INTEGRATION_DIR / f".env.{fw_env}"


def run_tests(ctx: Context, *, mode: str | None = None) -> None:
    """Run the integration suite against the current fw environment."""
    fw_env = _fw_env_name(ctx)
    mode = (mode or _choose_mode(ctx)).strip().lower()
    if mode not in TEST_MODES:
        raise CommandError(f"Unknown test mode: {mode}. Use one of {', '.join(TEST_MODES)}.")

    base_url, api_url = _resolve_urls(ctx)
    console.rule(f"Integration tests ({fw_env} · {mode})")
    console.kv_table(
        "Target",
        [
            ("FW_ENV", fw_env),
            ("UI", base_url or "(unset)"),
            ("API", api_url or "(unset — set FW_API_URL or deploy API host)"),
            ("mode", mode),
        ],
    )

    if not base_url:
        raise CommandError("Could not resolve UI base URL for this environment.")
    if mode in {"all", "api", "smoke", "convert"} and not api_url:
        console.warn(
            "API URL is empty. Smoke catalog/health and convert tests need "
            "FW_API_URL or a custom API host on this environment."
        )

    overlay = _dotenv_hint(fw_env)
    if overlay.is_file():
        console.info(f"Playwright will also load {overlay.relative_to(INTEGRATION_DIR.parent)}")
    elif mode in {"all", "convert", "api"} and not os.environ.get("FW_API_KEY"):
        console.warn(
            "FW_API_KEY not set. Convert POST tests will skip. "
            f"Copy integration/.env.example → integration/.env.{fw_env} "
            "or export FW_API_KEY=fw_live_…"
        )

    _ensure_integration_deps(ctx)

    env = {
        "FW_ENV": fw_env,
        "FW_BASE_URL": base_url,
    }
    if api_url:
        env["FW_API_URL"] = api_url
    # Preserve caller secrets if already exported.
    for key in ("FW_API_KEY", "FW_STORAGE_STATE", "FW_CONVERT_TIMEOUT_MS"):
        if key in os.environ:
            env[key] = os.environ[key]

    args = ["npx", "playwright", "test", *_playwright_args(mode)]
    result = run(args, cwd=INTEGRATION_DIR, ctx=ctx, env=env, check=False)
    if result.returncode != 0:
        raise CommandError(
            f"Integration tests failed ({result.returncode}). "
            "See integration/playwright-report/",
            result.returncode,
        )
    console.success(f"Integration tests passed ({fw_env} · {mode}).")


def all_tests(ctx: Context) -> None:
    """Run smoke + UI + API (and convert specs when a key is present)."""
    run_tests(ctx, mode="all")


def smoke(ctx: Context) -> None:
    run_tests(ctx, mode="smoke")


def api(ctx: Context) -> None:
    run_tests(ctx, mode="api")


def ui(ctx: Context) -> None:
    run_tests(ctx, mode="ui")


def convert(ctx: Context) -> None:
    run_tests(ctx, mode="convert")
