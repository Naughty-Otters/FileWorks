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
    app_bucket_name,
    state_bucket_name,
    terraform_state_key,
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
    merged.setdefault("AWS_PAGER", "")
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
    bucket = app_bucket_name(ctx.env)
    key = terraform_state_key(ctx.account_id)
    _maybe_migrate_remote_state(ctx, bucket=bucket, key=key)
    run(
        [
            "terraform",
            "init",
            "-input=false",
            "-reconfigure",
            f"-backend-config=bucket={bucket}",
            f"-backend-config=key={key}",
            f"-backend-config=region={ctx.region}",
            "-backend-config=encrypt=true",
            "-backend-config=use_lockfile=true",
        ],
        cwd=TF_DIR,
        ctx=ctx,
    )
    _ensure_app_bucket_imported(ctx, bucket)


def _s3_object_exists(ctx: Context, bucket: str, key: str) -> bool:
    result = run(
        [
            "aws",
            "s3api",
            "head-object",
            "--bucket",
            bucket,
            "--key",
            key,
            "--region",
            ctx.region,
        ],
        check=False,
        capture=True,
        ctx=ctx,
    )
    return result.returncode == 0


def _maybe_migrate_remote_state(ctx: Context, *, bucket: str, key: str) -> None:
    """Copy state from the legacy tfstate bucket into the app bucket once."""
    if _s3_object_exists(ctx, bucket, key):
        return
    legacy_bucket = state_bucket_name(ctx.account_id)
    legacy_key = f"fileworks/{ctx.env.name}/terraform.tfstate"
    if not _s3_object_exists(ctx, legacy_bucket, legacy_key):
        return
    console.info(
        f"Migrating Terraform state "
        f"s3://{legacy_bucket}/{legacy_key} → s3://{bucket}/{key}"
    )
    run(
        [
            "aws",
            "s3",
            "cp",
            f"s3://{legacy_bucket}/{legacy_key}",
            f"s3://{bucket}/{key}",
            "--region",
            ctx.region,
        ],
        ctx=ctx,
    )


def _ensure_app_bucket_imported(ctx: Context, bucket: str) -> None:
    """Bootstrap creates the app bucket; import it so the main stack can own it."""
    listed = run(
        ["terraform", "state", "list"],
        cwd=TF_DIR,
        check=False,
        capture=True,
        ctx=ctx,
    )
    resources = set((listed.stdout or "").split())
    if "aws_s3_bucket.uploads" in resources:
        return
    console.info(f"Importing existing app bucket {bucket} into Terraform state")
    run(
        [
            "terraform",
            "import",
            "-input=false",
            *terraform_var_files(ctx.env),
            "aws_s3_bucket.uploads",
            bucket,
        ],
        cwd=TF_DIR,
        check=False,
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


def bootstrap_state_path(
    account_id: str,
    env_name: str = "",
    directory: Path = BOOTSTRAP_DIR,
) -> Path:
    """Local bootstrap state is scoped per account + env (each env has its own app bucket)."""
    if env_name:
        return directory / f"terraform.{account_id}.{env_name}.tfstate"
    return directory / f"terraform.{account_id}.tfstate"


def _state_bucket(path: Path) -> str | None:
    try:
        state = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    for resource in state.get("resources", []):
        if resource.get("type") != "aws_s3_bucket" or resource.get("name") != "state":
            continue
        for instance in resource.get("instances", []):
            bucket = instance.get("attributes", {}).get("bucket")
            if isinstance(bucket, str) and bucket:
                return bucket
    return None


def prepare_bootstrap_state(
    account_id: str,
    env_name: str,
    directory: Path = BOOTSTRAP_DIR,
) -> Path:
    """Select account+env bootstrap state; optionally migrate older layouts."""
    target = bootstrap_state_path(account_id, env_name, directory)
    if target.exists():
        return target

    # Prefer account-only state that already manages this env's app bucket.
    account_only = bootstrap_state_path(account_id, "", directory)
    expected_bucket = app_bucket_name(env_name)
    if account_only.exists() and _state_bucket(account_only) == expected_bucket:
        account_only.replace(target)
        account_backup = directory / f"{account_only.name}.backup"
        target_backup = directory / f"{target.name}.backup"
        if account_backup.exists() and not target_backup.exists():
            account_backup.replace(target_backup)
        console.info(f"Migrated account bootstrap state to {target.name}.")
        return target

    legacy = directory / "terraform.tfstate"
    if not legacy.exists():
        return target

    legacy_bucket = _state_bucket(legacy)
    if legacy_bucket != expected_bucket:
        if legacy_bucket:
            console.info(
                f"Leaving legacy bootstrap state for {legacy_bucket}; "
                f"using {target.name}."
            )
        else:
            console.warn(
                f"Could not identify the bucket in legacy bootstrap state {legacy}; "
                f"using {target.name} without modifying it."
            )
        return target

    legacy.replace(target)
    legacy_backup = directory / "terraform.tfstate.backup"
    target_backup = directory / f"{target.name}.backup"
    if legacy_backup.exists() and not target_backup.exists():
        legacy_backup.replace(target_backup)
    console.info(f"Migrated legacy bootstrap state to {target.name}.")
    return target


def bootstrap_state(ctx: Context) -> None:
    require_cmd("terraform")
    bucket = app_bucket_name(ctx.env)
    state = prepare_bootstrap_state(ctx.account_id, ctx.env.name)
    run(["terraform", "init", "-input=false", "-reconfigure"], cwd=BOOTSTRAP_DIR, ctx=ctx)
    _ensure_bootstrap_bucket_imported(ctx, bucket=bucket, state=state)
    run(
        [
            "terraform",
            "apply",
            "-input=false",
            "-auto-approve",
            f"-state={state.name}",
            f"-backup={state.name}.backup",
            f"-var=aws_region={ctx.region}",
            f"-var=state_bucket={bucket}",
        ],
        cwd=BOOTSTRAP_DIR,
        ctx=ctx,
    )


def _ensure_bootstrap_bucket_imported(ctx: Context, *, bucket: str, state: Path) -> None:
    """If the env app bucket already exists, adopt it into bootstrap state."""
    listed = run(
        [
            "terraform",
            "state",
            "list",
            f"-state={state.name}",
        ],
        cwd=BOOTSTRAP_DIR,
        check=False,
        capture=True,
        ctx=ctx,
    )
    if "aws_s3_bucket.state" in (listed.stdout or "").split():
        return
    probe = run(
        [
            "aws",
            "s3api",
            "head-bucket",
            "--bucket",
            bucket,
            "--region",
            ctx.region,
        ],
        check=False,
        capture=True,
        ctx=ctx,
    )
    if probe.returncode != 0:
        return
    console.info(f"Importing existing app bucket {bucket} into bootstrap state")
    run(
        [
            "terraform",
            "import",
            f"-state={state.name}",
            f"-var=aws_region={ctx.region}",
            f"-var=state_bucket={bucket}",
            "aws_s3_bucket.state",
            bucket,
        ],
        cwd=BOOTSTRAP_DIR,
        check=False,
        ctx=ctx,
    )


APP_BUCKET_STATE_RESOURCES = (
    "aws_s3_bucket.uploads",
    "aws_s3_bucket_versioning.uploads",
    "aws_s3_bucket_server_side_encryption_configuration.uploads",
    "aws_s3_bucket_public_access_block.uploads",
    "aws_s3_bucket_cors_configuration.uploads",
    "aws_s3_bucket_lifecycle_configuration.uploads",
)


def detach_app_bucket_from_state(ctx: Context) -> None:
    """Drop app-bucket resources from state so destroy leaves tfstate intact."""
    listed = run(
        ["terraform", "state", "list"],
        cwd=TF_DIR,
        check=False,
        capture=True,
        ctx=ctx,
    )
    present = set((listed.stdout or "").split())
    to_rm = [name for name in APP_BUCKET_STATE_RESOURCES if name in present]
    if not to_rm:
        return
    console.info(
        "Detaching app bucket from Terraform state so destroy keeps "
        f"{app_bucket_name(ctx.env)} (and remote state) intact."
    )
    run(["terraform", "state", "rm", *to_rm], cwd=TF_DIR, ctx=ctx)


def ensure_frontend_deps() -> None:
    wrangler = FRONTEND_DIR / "node_modules" / "wrangler"
    if not wrangler.exists():
        require_cmd("npm")
        run(["npm", "install"], cwd=FRONTEND_DIR)


def wrangler(ctx: Context, *args: str, check: bool = True, capture: bool = False) -> subprocess.CompletedProcess[str]:
    require_cmd("npm")
    ensure_frontend_deps()
    return run(["npx", "--no-install", "wrangler", *args], cwd=FRONTEND_DIR, check=check, capture=capture, ctx=ctx)
