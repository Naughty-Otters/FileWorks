"""AWS Lambda + Cloudflare Pages workflows (ported from infra/deploy.py)."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import textwrap
import time
from pathlib import Path

from fw import console
from fw.context import (
    BACKEND_ENV,
    DOCKERFILE,
    FRONTEND_DIR,
    IAM_POLICY_PATH,
    POLICY_NAME,
    REQUIRED_IAM_ACTIONS,
    ROOT_DIR,
    SECRET_ENV_PREFIXES,
    SECRET_EXACT_KEYS,
    TF_DIR,
    Context,
    state_bucket_name,
)
from fw.tools import (
    CommandError,
    aws_json,
    bootstrap_state,
    require_cmd,
    run,
    terraform_cmd,
    terraform_init,
    terraform_output,
    terraform_var_files,
    wrangler,
)


def _iam_user_from_arn(arn: str) -> str | None:
    if ":user/" in arn:
        return arn.rsplit("/", 1)[-1]
    return None


def _parse_dotenv(path: Path | None = None) -> dict[str, str]:
    values: dict[str, str] = {}
    target = path or BACKEND_ENV
    if not target.exists():
        return values
    for line in target.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, raw = stripped.partition("=")
        key = key.strip()
        value = raw.strip().strip("'").strip('"')
        if key:
            values[key] = value
    return values


def _dotenv_paths(ctx: Context) -> list[Path]:
    paths = [BACKEND_ENV]
    overlay = ctx.env.dotenv_overlay
    if overlay not in paths:
        paths.append(overlay)
    return [path for path in paths if path.exists()]


def _parse_dotenv_for(ctx: Context) -> dict[str, str]:
    merged: dict[str, str] = {}
    for path in _dotenv_paths(ctx):
        merged.update(_parse_dotenv(path))
    return merged


def _dotenv_label(ctx: Context) -> str:
    paths = _dotenv_paths(ctx)
    if not paths:
        return str(BACKEND_ENV.relative_to(ROOT_DIR))
    return " + ".join(str(path.relative_to(ROOT_DIR)) for path in paths)


def _guard_prod_secrets(ctx: Context, payload: dict[str, str]) -> None:
    if not ctx.env.is_production:
        return
    stripe_key = payload.get("STRIPE_SECRET_KEY", "")
    if stripe_key.startswith("sk_test_"):
        raise CommandError(
            "Refusing to seed a Stripe test key into prod. "
            f"Put the live key in {ctx.env.dotenv_overlay.relative_to(ROOT_DIR)} "
            "(STRIPE_SECRET_KEY=sk_live_...)."
        )
    app_url = payload.get("PUBLIC_APP_URL", "")
    if app_url.startswith(("http://localhost", "http://127.0.0.1")):
        raise CommandError(
            "Refusing to seed a localhost PUBLIC_APP_URL into prod. "
            f"Set the live site URL in {ctx.env.dotenv_overlay.relative_to(ROOT_DIR)}."
        )


def check(ctx: Context) -> None:
    require_cmd("aws", "terraform", "docker")
    console.rule("Permissions")
    if ctx.session is None:
        raise CommandError("AWS session is not established")
    console.kv_table(
        "AWS session",
        [
            ("Profile", ctx.session.profile_label),
            ("Account", ctx.session.account_id),
            ("Region", ctx.session.region),
            ("Identity", ctx.session.arn),
            ("Environment", ctx.env.name),
        ],
    )

    console.rule("IAM simulation")
    data = aws_json(
        ctx,
        [
            "iam",
            "simulate-principal-policy",
            "--policy-source-arn",
            ctx.session.arn,
            "--action-names",
            *REQUIRED_IAM_ACTIONS,
        ],
    )
    denied: list[str] = []
    results = data.get("EvaluationResults") if isinstance(data, dict) else None
    rows: list[list[str]] = []
    if isinstance(results, list):
        for item in results:
            action = str(item.get("EvalActionName"))
            decision = str(item.get("EvalDecision"))
            allowed = decision.lower() == "allowed"
            rows.append([action, "[green]allowed[/green]" if allowed else f"[red]{decision}[/red]"])
            if not allowed:
                denied.append(action)
    console.data_table("Required deploy actions", ["Action", "Decision"], rows)
    if denied:
        console.warn("Attach FileWorksDeploy before a Lambda deploy can finish.")
        console.info(f"Policy file: {IAM_POLICY_PATH}")
    else:
        console.success("Required deploy actions are allowed.")

    console.rule("Cloudflare Pages")
    if shutil.which("npm") is None:
        console.warn("npm not found — frontend deploy needs Node.js 20+.")
        return
    who = wrangler(ctx, "whoami", check=False, capture=True)
    text = ((who.stdout or "") + (who.stderr or "")).strip()
    if who.returncode == 0:
        console.success("Wrangler is authenticated")
        for line in text.splitlines()[:8]:
            console.info(line)
        console.info(
            f"Pages projects: {ctx.env.pages_project} → {ctx.env.pages_origin}"
        )
    else:
        console.warn("Wrangler is not logged in. Frontend deploy will run `wrangler login`.")
        console.info("Or set CLOUDFLARE_API_TOKEN (+ optional CLOUDFLARE_ACCOUNT_ID).")


def attach_policy(ctx: Context) -> None:
    console.rule("Attach FileWorksDeploy IAM policy")
    if ctx.session is None:
        raise CommandError("AWS session is not established")
    user = _iam_user_from_arn(ctx.session.arn)
    if not user:
        raise CommandError("Current identity is not an IAM user (SSO/role). Attach the policy in the console.")
    policy_arn = f"arn:aws:iam::{ctx.account_id}:policy/{POLICY_NAME}"
    existing = run(
        ["aws", "iam", "get-policy", "--policy-arn", policy_arn],
        check=False,
        capture=True,
        ctx=ctx,
    )
    if existing.returncode != 0:
        run(
            [
                "aws",
                "iam",
                "create-policy",
                "--policy-name",
                POLICY_NAME,
                "--policy-document",
                f"file://{IAM_POLICY_PATH}",
                "--description",
                "FileWorks Terraform/Lambda/ECR deploy",
            ],
            ctx=ctx,
        )
        console.success(f"Created {policy_arn}")
    else:
        console.success(f"Policy already exists: {policy_arn}")
        console.warn("If you edited the JSON policy, create a new IAM policy version.")
    run(
        [
            "aws",
            "iam",
            "attach-user-policy",
            "--user-name",
            user,
            "--policy-arn",
            policy_arn,
        ],
        ctx=ctx,
    )
    console.success(f"Attached {POLICY_NAME} to IAM user {user}")
    console.info("IAM can take a few seconds to propagate. Re-run Check permissions next.")


def bootstrap(ctx: Context) -> None:
    console.rule("Bootstrap Terraform state bucket")
    console.info(f"Bucket {state_bucket_name(ctx.account_id)} in {ctx.region}")
    bootstrap_state(ctx)
    console.success("Remote state bucket is ready.")


def _require_buildx(ctx: Context) -> None:
    """Lambda only accepts Docker V2 schema 2, which needs buildx to pin."""
    probe = run(["docker", "buildx", "version"], check=False, capture=True, ctx=ctx)
    if probe.returncode != 0:
        raise CommandError(
            "docker buildx is required (Lambda rejects the OCI manifests plain "
            "`docker build` now produces). Install Docker Desktop or the buildx plugin."
        )


def _ecr_login(ctx: Context, repo_url: str) -> None:
    registry = repo_url.split("/", 1)[0]
    password = run(
        ["aws", "ecr", "get-login-password", "--region", ctx.region],
        capture=True,
        ctx=ctx,
    ).stdout.strip()
    login = subprocess.run(
        ["docker", "login", "--username", "AWS", "--password-stdin", registry],
        input=password,
        text=True,
        check=False,
        env={**os.environ, "HTTP_PROXY": "", "HTTPS_PROXY": "", "http_proxy": "", "https_proxy": ""},
    )
    if login.returncode != 0:
        raise CommandError("docker login to ECR failed")
    console.success(f"Logged into {registry}")


def push_image(ctx: Context) -> None:
    require_cmd("docker")
    _require_buildx(ctx)
    console.rule(f"Build & push Lambda image ({ctx.env.name})")
    terraform_init(ctx)
    run(
        [
            "terraform",
            "apply",
            "-input=false",
            "-auto-approve",
            "-target=aws_ecr_repository.api",
            "-target=aws_ecr_lifecycle_policy.api",
            *terraform_var_files(ctx.env),
        ],
        cwd=TF_DIR,
        ctx=ctx,
    )
    repo_url = f"{ctx.account_id}.dkr.ecr.{ctx.region}.amazonaws.com/{ctx.env.ecr_repository}"
    image = f"{repo_url}:{ctx.env.name}"
    _ecr_login(ctx, repo_url)
    # Lambda rejects OCI index / attestation manifests from recent BuildKit
    # defaults, so pin one linux/amd64 image with Docker V2 schema 2 media types.
    run(
        [
            "docker",
            "buildx",
            "build",
            "--platform",
            "linux/amd64",
            "--provenance=false",
            "--sbom=false",
            "-f",
            str(DOCKERFILE),
            "-t",
            image,
            "--output",
            f"type=image,name={image},oci-mediatypes=false,push=true",
            str(ROOT_DIR),
        ],
        ctx=ctx,
    )
    console.success(f"Pushed {image}")
    _roll_out_image(ctx, image)


def _roll_out_image(ctx: Context, image: str) -> None:
    """Point live functions at the image just pushed.

    Terraform holds image_uri as the ``:<env>`` tag, and that string does not
    change between pushes, so `apply` reports no diff and the function keeps
    running whatever digest it resolved on the day it was created. Re-pointing it
    at the same tag makes Lambda resolve the new digest.
    """
    for suffix in ("api", "llm"):
        name = f"{ctx.env.prefix}-{suffix}"
        try:
            run(
                [
                    "aws",
                    "lambda",
                    "update-function-code",
                    "--function-name",
                    name,
                    "--image-uri",
                    image,
                    "--no-cli-pager",
                ],
                capture=True,
                ctx=ctx,
            )
        except CommandError:
            console.info(f"{name} does not exist yet — `fw apply` will create it.")
            continue
        run(
            ["aws", "lambda", "wait", "function-updated", "--function-name", name],
            capture=True,
            ctx=ctx,
            check=False,
        )
        console.success(f"{name} now runs the image just pushed")


def plan(ctx: Context) -> None:
    console.rule(f"Terraform plan ({ctx.env.name})")
    terraform_init(ctx)
    terraform_cmd(ctx, ["plan"])


def apply(ctx: Context) -> None:
    console.rule(f"Terraform apply ({ctx.env.name})")
    if ctx.env.is_production and not ctx.auto_yes:
        if not console.confirm("Apply PRODUCTION?", default=False):
            console.warn("Cancelled.")
            return
    elif not ctx.auto_yes and not console.confirm(f"Apply {ctx.env.name}?", default=True):
        console.warn("Cancelled.")
        return
    terraform_init(ctx)
    terraform_cmd(ctx, ["apply", "-auto-approve"])
    status(ctx)


def destroy(ctx: Context) -> None:
    console.rule(f"Terraform destroy ({ctx.env.name})")
    if not console.confirm(f"Destroy ALL {ctx.env.name} FileWorks AWS resources?", default=False):
        console.warn("Cancelled.")
        return
    if ctx.env.is_production and not console.confirm_phrase("Confirm production destroy", "destroy"):
        console.warn("Cancelled.")
        return
    terraform_init(ctx)
    terraform_cmd(ctx, ["destroy", "-auto-approve"])
    console.success(f"{ctx.env.name} stack destroyed.")


def status(ctx: Context) -> None:
    console.rule(f"Status ({ctx.env.name})")
    outputs = terraform_output(ctx)
    rows = []
    for key in (
        "environment",
        "account_id",
        "region",
        "api_url",
        "ecr_repository_url",
        "history_bucket",
        "uploads_bucket",
        "secret_arn",
        "api_function_name",
        "llm_function_name",
        "db_address",
    ):
        value = outputs.get(key)
        if value:
            rows.append((key, str(value)))
    rows.append(("pages_url", ctx.env.pages_origin))
    console.kv_table("Stack", rows)
    api_url = str(outputs.get("api_url") or "").rstrip("/")
    if api_url:
        _probe_health(ctx, api_url)
        _check_cors(ctx, api_url, ctx.env.pages_origin)
        _check_ui_endpoint(ctx, ctx.env.pages_origin, api_url)
    for key, method in (("history_bucket", "GET"), ("uploads_bucket", "PUT")):
        bucket = str(outputs.get(key) or "")
        if bucket:
            _check_s3_cors(ctx, bucket, ctx.env.pages_origin, method)


# A cold start pulls the OCR image and boots FastAPI, so the first probe can
# take well over a minute. Retry instead of calling one slow attempt a failure.
HEALTH_ATTEMPTS = 4
HEALTH_TIMEOUT_S = 60
HEALTH_RETRY_WAIT_S = 10


def _probe_health(ctx: Context, api_url: str) -> bool:
    for attempt in range(1, HEALTH_ATTEMPTS + 1):
        health = run(
            ["curl", "-fsS", "--max-time", str(HEALTH_TIMEOUT_S), f"{api_url}/api/health"],
            check=False,
            capture=True,
            ctx=ctx,
        )
        if health.returncode == 0:
            console.success("API /api/health responded")
            console.info(textwrap.shorten((health.stdout or "").strip(), width=400, placeholder="…"))
            return True
        if attempt < HEALTH_ATTEMPTS:
            console.info(
                f"No health response yet (attempt {attempt}/{HEALTH_ATTEMPTS}); "
                f"waiting {HEALTH_RETRY_WAIT_S}s for cold start…"
            )
            time.sleep(HEALTH_RETRY_WAIT_S)
    console.warn(
        f"API health check failed after {HEALTH_ATTEMPTS} attempts "
        "(image missing, slow cold start, or CORS/network)."
    )
    console.info(f"Retry by hand: curl -i --max-time 90 {api_url}/api/health")
    return False


def seed_secrets(ctx: Context) -> None:
    console.rule(f"Seed Secrets Manager ({ctx.env.name})")
    outputs = terraform_output(ctx)
    secret_arn = str(outputs.get("secret_arn") or "")
    if not secret_arn:
        raise CommandError("secret_arn missing — apply the stack first.")
    parsed = _parse_dotenv_for(ctx)
    payload = {
        key: value
        for key, value in parsed.items()
        if value and (key in SECRET_EXACT_KEYS or key.startswith(SECRET_ENV_PREFIXES))
    }
    sources = _dotenv_label(ctx)
    if not payload:
        raise CommandError(f"No LLM/translate/Google/Stripe keys found in {sources}")
    _guard_prod_secrets(ctx, payload)
    existing: dict[str, str] = {}
    current = run(
        [
            "aws",
            "secretsmanager",
            "get-secret-value",
            "--secret-id",
            secret_arn,
            "--query",
            "SecretString",
            "--output",
            "text",
            "--region",
            ctx.region,
        ],
        check=False,
        capture=True,
        ctx=ctx,
    )
    if current.returncode == 0 and current.stdout:
        try:
            loaded = json.loads(current.stdout)
            if isinstance(loaded, dict):
                existing = {str(k): str(v) for k, v in loaded.items() if v is not None}
        except json.JSONDecodeError:
            existing = {}
    merged = {**existing, **payload}
    console.info(f"Updating {len(payload)} keys from {sources} (values are not printed).")
    run(
        [
            "aws",
            "secretsmanager",
            "put-secret-value",
            "--secret-id",
            secret_arn,
            "--secret-string",
            json.dumps(merged),
            "--region",
            ctx.region,
        ],
        ctx=ctx,
    )
    for fn_key in ("api_function_name", "llm_function_name"):
        fn = str(outputs.get(fn_key) or "")
        if fn:
            run(
                [
                    "aws",
                    "lambda",
                    "update-function-configuration",
                    "--function-name",
                    fn,
                    "--region",
                    ctx.region,
                ],
                check=False,
                capture=True,
                ctx=ctx,
            )
    console.success(f"Secret updated ({ctx.env.name}). Do not commit {sources}.")


def _write_local_cors(ctx: Context, origins: list[str]) -> None:
    unique: list[str] = []
    for origin in origins:
        if origin and origin not in unique:
            unique.append(origin)
    quoted = ",\n  ".join(json.dumps(item) for item in unique)
    ctx.env.local_tfvars_file.write_text(
        "cors_origins = [\n  " + quoted + "\n]\n",
        encoding="utf-8",
    )
    console.success(f"Wrote {ctx.env.local_tfvars_file}")


def _write_runtime_config(out_dir: Path, api_url: str, canonical_origin: str) -> None:
    """Point the built UI at the API without rebuilding any JS bundle."""
    payload = json.dumps({"apiUrl": api_url, "canonicalOrigin": canonical_origin})
    (out_dir / "config.js").write_text(
        "// Written by `fw frontend` from the Terraform api_url output.\n"
        f"window.__FILEWORKS_CONFIG__ = {payload};\n",
        encoding="utf-8",
    )
    console.success(f"UI endpoint pinned to {api_url}")
    console.info(f"Preview hosts redirect to {canonical_origin}")


def _check_cors(ctx: Context, api_url: str, origin: str) -> bool:
    """Preflight exactly like the browser, so drift surfaces at deploy time."""
    probe = run(
        [
            "curl",
            "-sS",
            "-o",
            "/dev/null",
            "-D",
            "-",
            "--max-time",
            "60",
            "-X",
            "OPTIONS",
            f"{api_url}/api/health",
            "-H",
            f"Origin: {origin}",
            "-H",
            "Access-Control-Request-Method: GET",
        ],
        check=False,
        capture=True,
        ctx=ctx,
    )
    allowed = origin.lower() in (probe.stdout or "").lower()
    if allowed:
        console.success(f"CORS ok for {origin}")
    else:
        console.warn(
            f"CORS check failed for {origin}. "
            "Confirm cors_origins in envs/<env>.tfvars, then re-run apply."
        )
    return allowed


def _check_s3_cors(ctx: Context, bucket: str, origin: str, method: str) -> bool:
    """The browser talks to S3 directly, so each bucket needs its own CORS rule.

    Uploads PUT to the uploads bucket and previews GET a presigned history URL.
    Neither goes through the API, so an out-of-date bucket rule is invisible to
    the API preflight check above and only shows up as a failed click.
    """
    probe = run(
        [
            "curl",
            "-sS",
            "-o",
            "/dev/null",
            "-D",
            "-",
            "--max-time",
            "30",
            "-X",
            "OPTIONS",
            f"https://{bucket}.s3.amazonaws.com/",
            "-H",
            f"Origin: {origin}",
            "-H",
            f"Access-Control-Request-Method: {method}",
        ],
        check=False,
        capture=True,
        ctx=ctx,
    )
    if origin.lower() in (probe.stdout or "").lower():
        console.success(f"S3 CORS ok for {method} on {bucket}")
        return True
    console.warn(
        f"S3 CORS check failed for {method} on {bucket} from {origin}. "
        "Confirm cors_origins in envs/<env>.tfvars, then re-run apply."
    )
    return False


def _check_ui_endpoint(ctx: Context, pages_origin: str, api_url: str) -> bool:
    """Catch a UI still pinned to an older API endpoint."""
    probe = run(
        ["curl", "-sS", "--max-time", "30", f"{pages_origin}/config.js"],
        check=False,
        capture=True,
        ctx=ctx,
    )
    if probe.returncode != 0:
        console.info("Could not read the deployed config.js (UI may not be published yet).")
        return False
    if api_url in (probe.stdout or ""):
        console.success(f"UI config.js matches {api_url}")
        return True
    console.warn(
        f"UI at {pages_origin} is not pinned to {api_url}. "
        "Run `fw --env <env> frontend` to refresh config.js."
    )
    return False


def _parse_pages_urls(text: str) -> list[str]:
    found: list[str] = []
    for match in re.findall(r"https://[a-zA-Z0-9.-]+\.pages\.dev", text):
        origin = match.rstrip("/")
        if origin not in found:
            found.append(origin)
    return found


def frontend(ctx: Context) -> None:
    console.rule(f"Cloudflare Pages ({ctx.env.name})")
    require_cmd("npm")
    outputs = terraform_output(ctx)
    api_url = str(outputs.get("api_url") or "").rstrip("/")
    if not api_url:
        raise CommandError("api_url missing — apply the AWS stack first.")

    who = wrangler(ctx, "whoami", check=False, capture=True)
    if who.returncode != 0:
        console.warn("Not logged into Cloudflare. Opening `wrangler login`…")
        wrangler(ctx, "login")

    project = ctx.env.pages_project
    created = wrangler(
        ctx,
        "pages",
        "project",
        "create",
        project,
        "--production-branch",
        "main",
        check=False,
        capture=True,
    )
    if created.returncode == 0:
        console.success(f"Created Pages project {project}")
    else:
        console.info(f"Pages project {project} already exists (or create skipped).")

    parsed = _parse_dotenv_for(ctx)
    google_client_id = str(outputs.get("google_client_id") or parsed.get("GOOGLE_CLIENT_ID") or "").strip()
    frontend_env = {
        "FILEWORKS_STATIC_EXPORT": "1",
        "NEXT_PUBLIC_API_URL": api_url,
        "NEXT_PUBLIC_DIRECT_UPLOAD": "1",
    }
    if google_client_id:
        frontend_env["NEXT_PUBLIC_GOOGLE_CLIENT_ID"] = google_client_id
    run(
        ["npm", "run", "build"],
        cwd=FRONTEND_DIR,
        env=frontend_env,
        ctx=ctx,
    )
    out_dir = FRONTEND_DIR / "out"
    if not out_dir.is_dir():
        raise CommandError("frontend/out missing after build — static export failed.")
    _write_runtime_config(out_dir, api_url, ctx.env.pages_origin)

    deploy = wrangler(
        ctx,
        "pages",
        "deploy",
        str(out_dir),
        "--project-name",
        project,
        "--branch",
        "main",
        "--commit-dirty=true",
        capture=True,
    )
    combined = (deploy.stdout or "") + (deploy.stderr or "")
    preview_urls = [u for u in _parse_pages_urls(combined) if u != ctx.env.pages_origin]
    # Always hand back the stable alias. Per-deployment hosts (<hash>.<project>.pages.dev)
    # are deliberately kept out of CORS: they change every deploy, S3 CORS has no regex,
    # and Google OAuth needs each origin registered by hand.
    frontend_url = ctx.env.pages_origin
    if not ctx.env.is_production:
        _write_local_cors(ctx, ["http://localhost:3000", "http://127.0.0.1:3000", frontend_url])
        console.info("Updating API + S3 CORS for the stable Pages origin.")
        terraform_cmd(ctx, ["apply", "-auto-approve"])
    else:
        console.info("Prod CORS is owned by envs/prod.tfvars (exact origins only).")
    console.success(f"Frontend published → {frontend_url}")
    if preview_urls:
        console.info(
            "Per-deployment preview host: "
            + ", ".join(preview_urls)
            + " — sign-in only works on origins registered with Google; use the stable URL."
        )
    console.info(f"API {api_url}")
    _check_cors(ctx, api_url, frontend_url)


def full(ctx: Context) -> None:
    console.rule(f"Full deploy ({ctx.env.name})")
    console.info("Order: AWS Lambda API → Cloudflare Pages UI")
    if not ctx.auto_yes and not console.confirm(
        f"Run the full {ctx.env.name} pipeline?", default=not ctx.env.is_production
    ):
        console.warn("Cancelled.")
        return
    bootstrap(ctx)
    push_image(ctx)
    previous = ctx.auto_yes
    ctx.auto_yes = True
    try:
        apply(ctx)
    finally:
        ctx.auto_yes = previous
    if _dotenv_paths(ctx) and console.confirm(
        f"Seed secrets from {_dotenv_label(ctx)}?", default=True
    ):
        seed_secrets(ctx)
    if console.confirm("Build and publish the frontend to Cloudflare Pages?", default=True):
        frontend(ctx)
    status(ctx)
