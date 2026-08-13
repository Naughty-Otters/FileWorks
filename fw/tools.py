"""AWS CLI, Terraform, Docker, and npm helpers used by actions."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from fw import console
from fw.context import (
    BOOTSTRAP_DIR,
    FRONTEND_DIR,
    TF_DIR,
    Context,
    Environment,
    state_bucket_name,
)
from fw.process import run_streaming


class CommandError(RuntimeError):
    def __init__(self, message: str, code: int = 1):
        super().__init__(message)
        self.code = code


def child_env(extra: dict[str, str] | None = None, *, profile: str | None = None, region: str | None = None) -> dict[str, str]:
    merged = os.environ.copy()
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"):
        merged.pop(key, None)
    merged["NO_PROXY"] = "*"
    if profile:
        merged["AWS_PROFILE"] = profile
    if region:
        merged["AWS_REGION"] = region
        merged["AWS_DEFAULT_REGION"] = region
    if extra:
        merged.update(extra)
    return merged


def run(
    args: list[str],
    *,
    cwd: Path | None = None,
    env: dict[str, str] | None = None,
    check: bool = True,
    capture: bool = False,
    ctx: Context | None = None,
) -> subprocess.CompletedProcess[str]:
    display = " ".join(args)
    console.info(f"$ {display}")
    profile = ctx.session.profile if ctx and ctx.session else None
    region = ctx.session.region if ctx and ctx.session else (ctx.region if ctx else None)
    merged = child_env(env, profile=profile, region=region)
    workdir = str(cwd) if cwd else None
    if capture:
        result = subprocess.run(
            args,
            cwd=workdir,
            env=merged,
            check=False,
            text=True,
            capture_output=True,
        )
    else:
        code = run_streaming(args, env=merged, cwd=workdir)
        result = subprocess.CompletedProcess(args, code, stdout="", stderr="")
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        if detail:
            console.error(detail[-2000:])
        raise CommandError(f"Command failed ({result.returncode}): {display}", result.returncode)
    return result


def require_cmd(*names: str) -> None:
    missing = [name for name in names if shutil.which(name) is None]
    if missing:
        raise CommandError("Missing tools: " + ", ".join(missing))


def aws_json(ctx: Context, args: list[str]) -> object:
    require_cmd("aws")
    cmd = ["aws", *args, "--output", "json", "--region", ctx.region]
    result = run(cmd, capture=True, ctx=ctx)
    text = (result.stdout or "").strip()
    return json.loads(text) if text else None


def terraform_var_files(env: Environment) -> list[str]:
    args = [f"-var-file={env.tfvars_file}"]
    if env.local_tfvars_file.exists():
        args.append(f"-var-file={env.local_tfvars_file}")
    return args


def terraform_init(ctx: Context) -> None:
    require_cmd("terraform")
    run(
        [
            "terraform",
            "init",
            "-input=false",
            "-reconfigure",
            f"-backend-config=bucket={state_bucket_name(ctx.account_id)}",
            f"-backend-config=key=fileworks/{ctx.env.name}/terraform.tfstate",
            f"-backend-config=region={ctx.region}",
            "-backend-config=encrypt=true",
            "-backend-config=use_lockfile=true",
        ],
        cwd=TF_DIR,
        ctx=ctx,
    )


def terraform_cmd(ctx: Context, action: list[str]) -> subprocess.CompletedProcess[str]:
    return run(
        ["terraform", *action, "-input=false", *terraform_var_files(ctx.env)],
        cwd=TF_DIR,
        ctx=ctx,
    )


def terraform_output(ctx: Context) -> dict[str, object]:
    terraform_init(ctx)
    result = run(["terraform", "output", "-json"], cwd=TF_DIR, capture=True, check=False, ctx=ctx)
    if result.returncode != 0:
        console.warn("Terraform outputs unavailable — apply the stack first.")
        return {}
    raw = json.loads(result.stdout or "{}")
    if not isinstance(raw, dict):
        return {}
    return {key: item.get("value") for key, item in raw.items()}


def bootstrap_state(ctx: Context) -> None:
    require_cmd("terraform")
    bucket = state_bucket_name(ctx.account_id)
    run(["terraform", "init", "-input=false", "-reconfigure"], cwd=BOOTSTRAP_DIR, ctx=ctx)
    run(
        [
            "terraform",
            "apply",
            "-input=false",
            "-auto-approve",
            f"-var=aws_region={ctx.region}",
            f"-var=state_bucket={bucket}",
        ],
        cwd=BOOTSTRAP_DIR,
        ctx=ctx,
    )


def ensure_frontend_deps() -> None:
    wrangler = FRONTEND_DIR / "node_modules" / "wrangler"
    if not wrangler.exists():
        require_cmd("npm")
        run(["npm", "install"], cwd=FRONTEND_DIR)


def wrangler(ctx: Context, *args: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
    require_cmd("npm")
    ensure_frontend_deps()
    return run(["npx", "--no-install", "wrangler", *args], cwd=FRONTEND_DIR, check=check, capture=capture, ctx=ctx)
