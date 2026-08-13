"""AWS Lambda + Cloudflare Pages workflows (ported from infra/deploy.py)."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import textwrap

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


def _parse_dotenv() -> dict[str, str]:
    values: dict[str, str] = {}
    if not BACKEND_ENV.exists():
        return values
    for line in BACKEND_ENV.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, raw = stripped.partition("=")
        key = key.strip()
        value = raw.strip().strip("'").strip('"')
        if key:
            values[key] = value
    return values


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
    run(
        [
            "docker",
            "build",
            "--platform",
            "linux/amd64",
            "-f",
            str(DOCKERFILE),
            "-t",
            image,
            str(ROOT_DIR),
        ],
        ctx=ctx,
    )
    run(["docker", "push", image], ctx=ctx)
    console.success(f"Pushed {image}")


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
        health = run(
            ["curl", "-fsS", "--max-time", "20", f"{api_url}/api/health"],
            check=False,
            capture=True,
            ctx=ctx,
        )
        if health.returncode == 0:
            console.success("API /api/health responded")
            console.info(textwrap.shorten((health.stdout or "").strip(), width=400, placeholder="…"))
        else:
            console.warn("API health check failed (image missing, cold start, or CORS/network).")


def seed_secrets(ctx: Context) -> None:
    console.rule(f"Seed Secrets Manager ({ctx.env.name})")
    outputs = terraform_output(ctx)
    secret_arn = str(outputs.get("secret_arn") or "")
    if not secret_arn:
        raise CommandError("secret_arn missing — apply the stack first.")
    parsed = _parse_dotenv()
    payload = {
        key: value
        for key, value in parsed.items()
        if value and (key in SECRET_EXACT_KEYS or key.startswith(SECRET_ENV_PREFIXES))
    }
    if not payload:
        raise CommandError(f"No LLM/translate/Google keys found in {BACKEND_ENV}")
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
    console.info(f"Updating {len(payload)} keys from .env (values are not printed).")
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
    console.success("Secret updated. Do not commit backend/.env.")


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

    run(
        ["npm", "run", "build"],
        cwd=FRONTEND_DIR,
        env={
            "FILEWORKS_STATIC_EXPORT": "1",
            "NEXT_PUBLIC_API_URL": api_url,
            "NEXT_PUBLIC_DIRECT_UPLOAD": "1",
        },
        ctx=ctx,
    )
    out_dir = FRONTEND_DIR / "out"
    if not out_dir.is_dir():
        raise CommandError("frontend/out missing after build — static export failed.")

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
    urls = _parse_pages_urls(combined)
    frontend_url = ctx.env.pages_origin
    if urls:
        stable = [u for u in urls if u == frontend_url] or urls
        frontend_url = stable[0]
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        ctx.env.pages_origin,
        *urls,
    ]
    _write_local_cors(ctx, origins)
    console.info("Updating Lambda Function URL + S3 CORS for the Pages origin.")
    terraform_cmd(ctx, ["apply", "-auto-approve"])
    console.success(f"Frontend published → {frontend_url}")
    console.info(f"API {api_url}")


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
    if BACKEND_ENV.exists() and console.confirm("Seed LLM/translate secrets from backend/.env?", default=True):
        seed_secrets(ctx)
    if console.confirm("Build and publish the frontend to Cloudflare Pages?", default=True):
        frontend(ctx)
    status(ctx)
