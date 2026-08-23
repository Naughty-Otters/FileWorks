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
    DEFAULT_LAMBDA_ACCOUNT_CONCURRENCY,
    DOCKERFILE,
    FRONTEND_DIR,
    IAM_POLICY_PATH,
    LAMBDA_CONCURRENT_QUOTA_CODE,
    LAMBDA_CONCURRENT_SERVICE,
    POLICY_NAME,
    REQUIRED_IAM_ACTIONS,
    ROOT_DIR,
    SECRET_ENV_PREFIXES,
    SECRET_EXACT_KEYS,
    TF_DIR,
    Context,
    is_lambda_function_url,
    lambda_logs_tail_args,
    resolve_lambda_log_groups,
    app_bucket_name,
    resolve_public_api_url,
    terraform_state_key,
)
from fw.tools import (
    CommandError,
    aws_json,
    bootstrap_state,
    detach_app_bucket_from_state,
    ensure_frontend_deps,
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

    _show_lambda_quota(ctx)

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
        versioned = run(
            [
                "aws",
                "iam",
                "create-policy-version",
                "--policy-arn",
                policy_arn,
                "--policy-document",
                f"file://{IAM_POLICY_PATH}",
                "--set-as-default",
            ],
            check=False,
            ctx=ctx,
        )
        if versioned.returncode == 0:
            console.success("Published a new FileWorksDeploy policy version.")
        else:
            console.warn(
                "Could not create a new policy version (IAM keeps 5). "
                "Delete an old version in the console, then re-run attach-policy."
            )
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


def _lambda_account_concurrency(ctx: Context) -> int:
    path = ctx.env.tfvars_file
    if path.exists():
        match = re.search(
            r"^\s*lambda_account_concurrency\s*=\s*(\d+)",
            path.read_text(encoding="utf-8"),
            re.MULTILINE,
        )
        if match:
            return int(match.group(1))
    return DEFAULT_LAMBDA_ACCOUNT_CONCURRENCY


def _aws_json_unchecked(ctx: Context, args: list[str]) -> tuple[object | None, str]:
    require_cmd("aws")
    result = run(
        ["aws", *args, "--output", "json", "--region", ctx.region],
        capture=True,
        check=False,
        ctx=ctx,
    )
    err = (result.stderr or result.stdout or "").strip()
    if result.returncode != 0:
        return None, err
    text = (result.stdout or "").strip()
    if not text:
        return {}, ""
    try:
        return json.loads(text), ""
    except json.JSONDecodeError:
        return None, err or text


def _quota_value(payload: object) -> int | None:
    if not isinstance(payload, dict):
        return None
    quota = payload.get("Quota")
    if not isinstance(quota, dict):
        return None
    raw = quota.get("Value")
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    return int(raw)


def _aws_error_code(message: str) -> str:
    match = re.search(r"\(([A-Za-z0-9]+)\)", message)
    return match.group(1) if match else ""


def _show_lambda_quota(ctx: Context) -> None:
    desired = _lambda_account_concurrency(ctx)
    payload, err = _aws_json_unchecked(
        ctx,
        [
            "service-quotas",
            "get-service-quota",
            "--service-code",
            LAMBDA_CONCURRENT_SERVICE,
            "--quota-code",
            LAMBDA_CONCURRENT_QUOTA_CODE,
        ],
    )
    console.rule("Lambda concurrency quota")
    current = _quota_value(payload)
    if current is None:
        console.warn(err or "Could not read Concurrent executions (L-B99A9384).")
        if "AccessDenied" in (err or ""):
            console.info("Run `fw attach-policy`, then `fw lambda-quota`.")
        return
    console.kv_table(
        "Account quota (not per-environment)",
        [
            ("current", str(current)),
            ("desired", str(desired)),
            ("quota", LAMBDA_CONCURRENT_QUOTA_CODE),
        ],
    )
    if current >= desired:
        console.success(
            f"Concurrent executions is {current} (AWS default is 1000). No quota increase needed."
        )
    else:
        console.warn(
            f"Concurrent executions is {current}; Lambda will not scale past that. "
            f"Run `fw lambda-quota` to request {desired}."
        )


def request_lambda_quota(ctx: Context) -> None:
    """Request a higher account-wide Lambda Concurrent executions quota."""
    require_cmd("aws")
    desired = _lambda_account_concurrency(ctx)
    console.rule("Lambda concurrency quota")
    console.info(
        f"This raises Concurrent executions ({LAMBDA_CONCURRENT_QUOTA_CODE}) "
        f"for the whole AWS account, not just {ctx.env.name}."
    )
    payload, err = _aws_json_unchecked(
        ctx,
        [
            "service-quotas",
            "get-service-quota",
            "--service-code",
            LAMBDA_CONCURRENT_SERVICE,
            "--quota-code",
            LAMBDA_CONCURRENT_QUOTA_CODE,
        ],
    )
    current = _quota_value(payload)
    if current is None:
        hint = "Run `fw attach-policy` first." if "AccessDenied" in (err or "") else err
        raise CommandError(hint or "Could not read the Lambda concurrent-executions quota.")
    console.kv_table(
        "Account quota",
        [("current", str(current)), ("desired", str(desired)), ("region", ctx.region)],
    )
    if current >= desired:
        console.success(
            f"Already at {current} (AWS default is 1000). No increase needed — "
            "AWS rejects a desired value at or below the current quota."
        )
        if current >= 1000:
            console.info(
                "A console value of 10 is reserved concurrency on the function, "
                "not this account quota. `fw apply` sets reserved to unreserved (-1)."
            )
        return
    if not ctx.auto_yes and not console.confirm(
        f"Request increase from {current} to {desired}?",
        default=True,
    ):
        console.warn("Cancelled.")
        return
    requested, req_err = _aws_json_unchecked(
        ctx,
        [
            "service-quotas",
            "request-service-quota-increase",
            "--service-code",
            LAMBDA_CONCURRENT_SERVICE,
            "--quota-code",
            LAMBDA_CONCURRENT_QUOTA_CODE,
            "--desired-value",
            str(desired),
        ],
    )
    if requested is None:
        code = _aws_error_code(req_err)
        if code in {"ResourceAlreadyExistsException", "DuplicateRequestException"}:
            console.warn("A quota increase request is already pending. AWS emails when it is approved.")
            return
        if code == "IllegalArgumentException" or "greater than the default quota" in req_err:
            console.success(
                "Account quota is already at the AWS default (1000). "
                "Requesting a lower value is a decrease; AWS only accepts a number above 1000."
            )
            return
        if "AccessDenied" in req_err:
            raise CommandError(
                "Denied. Run `fw attach-policy`, wait a few seconds, then retry `fw lambda-quota`."
            )
        raise CommandError(req_err or "Quota increase request failed.")
    detail = requested.get("RequestedQuota") if isinstance(requested, dict) else None
    status = ""
    request_id = ""
    if isinstance(detail, dict):
        status = str(detail.get("Status") or "")
        request_id = str(detail.get("Id") or "")
    console.success(
        f"Requested Concurrent executions {current} → {desired}"
        + (f" ({status})" if status else "")
        + (f" id={request_id}" if request_id else "")
    )
    console.info(
        "AWS only accepts a value above the current quota (default 1000). "
        "If AWS asks for a support case, wait for that email."
    )


def bootstrap(ctx: Context) -> None:
    bucket = app_bucket_name(ctx.env)
    key = terraform_state_key(ctx.account_id)
    console.rule("Bootstrap app bucket (data + Terraform state)")
    console.info(f"Bucket s3://{bucket}/  state key {key}")
    bootstrap_state(ctx)
    console.success(f"App bucket ready — remote state at s3://{bucket}/{key}")


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


def lambda_image_build_cmd(image: str) -> list[str]:
    """Docker V2 schema 2 linux/amd64 image. Extras come from pyproject.toml."""
    return [
        "docker",
        "buildx",
        "build",
        "--platform",
        "linux/amd64",
        "--provenance=false",
        "--sbom=false",
        "--build-context",
        f"model-cache=docker-image://{image}",
        "-f",
        str(DOCKERFILE),
        "-t",
        image,
        "--output",
        f"type=image,name={image},oci-mediatypes=false,push=true",
        str(ROOT_DIR),
    ]


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
    run(lambda_image_build_cmd(image), ctx=ctx)
    console.success(f"Pushed {image}")
    _roll_out_image(ctx, image)


def ecr_image_digest_uri(ctx: Context, image: str) -> str:
    """Resolve ``repo:tag`` to ``repo@sha256:...``.

    Lambda stores the tag string, not a moving pointer. ``update-function-code``
    with the same ``:staging`` URI is a no-op even after ECR moved the tag, so
    live kept running the first digest that tag ever resolved to.
    """
    repo_url, sep, tag = image.rpartition(":")
    if not sep or not tag or "/" not in repo_url:
        raise CommandError(f"expected repo:tag image URI, got {image}")
    repo_name = repo_url.rsplit("/", 1)[-1]
    digest = run(
        [
            "aws",
            "ecr",
            "describe-images",
            "--repository-name",
            repo_name,
            "--image-ids",
            f"imageTag={tag}",
            "--query",
            "imageDetails[0].imageDigest",
            "--output",
            "text",
            "--no-cli-pager",
        ],
        capture=True,
        ctx=ctx,
    ).stdout.strip()
    if not digest.startswith("sha256:"):
        raise CommandError(f"ECR did not return a digest for {image} (got {digest!r})")
    return f"{repo_url}@{digest}"


def _roll_out_image(ctx: Context, image: str) -> None:
    """Point live functions at the image just pushed.

    Terraform holds image_uri as the ``:<env>`` tag, and that string does not
    change between pushes, so `apply` reports no diff. Passing the digest (not
    the tag) is what actually moves Lambda onto the layers just pushed.

    The API Function URL targets the ``live`` alias (not $LATEST), so each push
    publishes a version and moves the alias after the image update succeeds.
    """
    pinned = ecr_image_digest_uri(ctx, image)
    console.info(f"Lambda image pin {pinned}")
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
                    pinned,
                    "--no-cli-pager",
                ],
                capture=True,
                ctx=ctx,
            )
        except CommandError:
            console.info(f"{name} does not exist yet — `fw apply` will create it.")
            continue
        waited = run(
            ["aws", "lambda", "wait", "function-updated", "--function-name", name],
            capture=True,
            ctx=ctx,
            check=False,
        )
        status = run(
            [
                "aws",
                "lambda",
                "get-function-configuration",
                "--function-name",
                name,
                "--query",
                "{Status:LastUpdateStatus,Reason:LastUpdateStatusReason,Sha:CodeSha256}",
                "--output",
                "json",
                "--no-cli-pager",
            ],
            capture=True,
            ctx=ctx,
        )
        payload = json.loads(status.stdout or "{}")
        if str(payload.get("Status") or "") != "Successful":
            raise CommandError(
                f"{name} did not switch to {pinned}: "
                f"{payload.get('Status')} {payload.get('Reason')} "
                f"(still {payload.get('Sha')}). "
                "Lambda uncompressed images must stay under 10 GiB; "
                "do not publish-version from a failed update."
            )
        if waited.returncode != 0:
            console.info(f"{name} waiter raced; configuration is Successful")
        console.success(f"{name} now runs {pinned}")
        if suffix != "api":
            continue
        published = run(
            [
                "aws",
                "lambda",
                "publish-version",
                "--function-name",
                name,
                "--output",
                "json",
                "--no-cli-pager",
            ],
            capture=True,
            check=False,
            ctx=ctx,
        )
        version = ""
        if published.returncode == 0:
            try:
                payload = json.loads(published.stdout or "{}")
                version = str(payload.get("Version") or "")
            except json.JSONDecodeError:
                version = ""
        if not version or version == "$LATEST":
            console.info(f"{name}:live not updated (publish-version failed) — `fw apply` will retarget the alias.")
            continue
        alias = run(
            [
                "aws",
                "lambda",
                "update-alias",
                "--function-name",
                name,
                "--name",
                "live",
                "--function-version",
                version,
                "--no-cli-pager",
            ],
            capture=True,
            check=False,
            ctx=ctx,
        )
        if alias.returncode == 0:
            console.success(f"{name}:live now runs published version {version}")
        else:
            console.info(f"{name}:live alias does not exist yet — `fw apply` creates it.")


def plan(ctx: Context) -> None:
    console.rule(f"Terraform plan ({ctx.env.name})")
    terraform_init(ctx)
    terraform_cmd(ctx, ["plan"])


def cost(ctx: Context) -> None:
    """Cost Explorer spend (daily/weekly/monthly) plus optional Terraform estimate."""
    estimate_only = ctx.extras.get("estimate_only") == "1"
    show_estimate = ctx.extras.get("estimate") == "1" or estimate_only

    if not estimate_only:
        period = (ctx.extras.get("period") or "").strip().lower()
        if period not in {"daily", "weekly", "monthly"}:
            period = console.select(
                "Cost Explorer period",
                [
                    console.Choice("daily", "Daily", "last 14 days"),
                    console.Choice("weekly", "Weekly", "last 8 weeks"),
                    console.Choice("monthly", "Monthly", "last ~6 months"),
                ],
                default="monthly",
            )
        _cost_explorer(ctx, period)

    if show_estimate:
        _cost_estimate(ctx)

    if ctx.extras.get("infracost") == "1":
        _cost_infracost(ctx)

    if not show_estimate and ctx.extras.get("infracost") != "1":
        console.blank()
        console.info(
            "Also available: "
            f"`fw --env {ctx.env.name} cost --period daily|weekly|monthly` · "
            f"`fw --env {ctx.env.name} cost --estimate`"
        )


def _cost_estimate(ctx: Context) -> None:
    from fw.costing import estimate_monthly, format_usd, load_env_settings

    console.rule(f"Estimated monthly floor ({ctx.env.name})")
    settings = load_env_settings(ctx.env.tfvars_file, ctx.env.local_tfvars_file)
    breakdown = estimate_monthly(ctx.env.name, settings)

    console.kv_table(
        "Config drivers",
        [
            ("environment", breakdown.environment),
            ("region", breakdown.region),
            ("NAT gateway", "on" if settings.get("enable_nat_gateway", True) else "off"),
            ("RDS class", str(settings.get("db_instance_class"))),
            ("API memory", f"{settings.get('lambda_memory_mb')} MB"),
            (
                "provisioned",
                f"min={settings.get('lambda_provisioned_min')} max={settings.get('lambda_provisioned_max')}",
            ),
        ],
    )

    fixed_rows = [
        (line.name, format_usd(line.monthly_usd), line.detail)
        for line in breakdown.lines
        if line.category == "fixed"
    ]
    console.data_table(
        "Fixed monthly (always-on floor)",
        ["Resource", "USD/mo", "Detail"],
        [*fixed_rows, ("TOTAL FIXED", format_usd(breakdown.fixed_total), "")],
    )

    scale_rows = [
        (line.name, format_usd(line.monthly_usd), line.detail)
        for line in breakdown.lines
        if line.category == "scale"
    ]
    if scale_rows:
        console.data_table(
            "Scale-out ceiling (if provisioned sits at max all month)",
            ["Resource", "USD/mo", "Detail"],
            [
                *scale_rows,
                (
                    "FLOOR + CEILING",
                    format_usd(breakdown.fixed_total + breakdown.scale_ceiling),
                    "",
                ),
            ],
        )

    for note in breakdown.notes:
        console.info(note)


def _cost_explorer(ctx: Context, period: str) -> None:
    """Show Cost Explorer spend for the chosen period."""
    from fw.costing import (
        format_usd,
        resolve_cost_period,
        series_from_ce_results,
        services_from_ce_results,
    )

    require_cmd("aws")
    window = resolve_cost_period(period)
    console.rule(f"Cost Explorer — {window.label}")
    console.info(
        f"Account {ctx.account_id} · {window.start.isoformat()} → {window.end.isoformat()} "
        f"(end exclusive) · trying Environment={ctx.env.name} tag filter"
    )

    results = _ce_get_cost_and_usage(
        ctx,
        start=window.start.isoformat(),
        end=window.end.isoformat(),
        granularity=window.granularity,
        group_by=None,
        env_tag=ctx.env.name,
    )
    used_tag = True
    if results is None:
        used_tag = False
        console.warn(
            "No spend matched the Environment cost-allocation tag "
            f"(activate it in Billing → Cost allocation tags, or costs are untagged). "
            f"Falling back to account-wide spend."
        )
        results = _ce_get_cost_and_usage(
            ctx,
            start=window.start.isoformat(),
            end=window.end.isoformat(),
            granularity=window.granularity,
            group_by=None,
            env_tag=None,
        ) or []

    series = series_from_ce_results(period, results)
    total = sum(point.amount for point in series)
    unit = {"daily": "Day", "weekly": "Week", "monthly": "Month"}[period]
    console.data_table(
        f"Spend by {unit.lower()}" + ("" if used_tag else " (account-wide)"),
        [unit, "USD"],
        [*((point.label, format_usd(point.amount)) for point in series), ("TOTAL", format_usd(total))],
    )

    service_results = _ce_get_cost_and_usage(
        ctx,
        start=window.start.isoformat(),
        end=window.end.isoformat(),
        granularity=window.granularity,
        group_by="SERVICE",
        env_tag=ctx.env.name if used_tag else None,
    ) or []
    services = services_from_ce_results(service_results)
    service_total = sum(amount for _, amount in services)
    console.data_table(
        "By service (same window)",
        ["Service", "USD"],
        [
            *((name, format_usd(amount)) for name, amount in services[:25]),
            ("TOTAL", format_usd(service_total)),
        ],
    )


def _ce_get_cost_and_usage(
    ctx: Context,
    *,
    start: str,
    end: str,
    granularity: str,
    group_by: str | None,
    env_tag: str | None,
) -> list[dict] | None:
    """Call Cost Explorer. Returns None when a tag filter yields no rows."""
    import json

    args = [
        "ce",
        "get-cost-and-usage",
        "--time-period",
        f"Start={start},End={end}",
        "--granularity",
        granularity,
        "--metrics",
        "UnblendedCost",
    ]
    if group_by:
        args.extend(["--group-by", f"Type=DIMENSION,Key={group_by}"])
    if env_tag:
        filt = {
            "Tags": {
                "Key": "Environment",
                "Values": [env_tag],
            }
        }
        args.extend(["--filter", json.dumps(filt)])

    try:
        payload = aws_json(ctx, args)
    except CommandError as exc:
        console.warn(f"Cost Explorer request failed: {exc}")
        return [] if env_tag is None else None

    if not isinstance(payload, dict):
        return [] if env_tag is None else None
    results = [item for item in (payload.get("ResultsByTime") or []) if isinstance(item, dict)]
    if env_tag is not None:
        # Tag filter with no matching allocation data → empty or all-zero totals.
        total = 0.0
        from fw.costing import parse_ce_amount, services_from_ce_results

        if group_by:
            total = sum(amount for _, amount in services_from_ce_results(results))
        else:
            total = sum(parse_ce_amount(item.get("Total") or {}) for item in results)
        if total < 0.005:
            return None
    return results


def _cost_infracost(ctx: Context) -> None:
    require_cmd("infracost", "terraform")
    console.rule("Infracost (Terraform plan)")
    terraform_init(ctx)
    plan_path = TF_DIR / f".fw-cost-{ctx.env.name}.tfplan"
    json_path = TF_DIR / f".fw-cost-{ctx.env.name}.json"
    try:
        terraform_cmd(ctx, ["plan", f"-out={plan_path.name}"])
        shown = run(
            ["terraform", "show", "-json", plan_path.name],
            cwd=TF_DIR,
            capture=True,
            ctx=ctx,
        )
        json_path.write_text(shown.stdout or "{}", encoding="utf-8")
        run(
            ["infracost", "breakdown", "--path", str(json_path)],
            cwd=TF_DIR,
            ctx=ctx,
        )
    finally:
        for path in (plan_path, json_path):
            if path.exists():
                path.unlink()


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
    detach_app_bucket_from_state(ctx)
    terraform_cmd(ctx, ["destroy", "-auto-approve"])
    console.success(
        f"{ctx.env.name} stack destroyed. "
        f"App bucket {app_bucket_name(ctx.env)} (and Terraform state) was left in place."
    )


def status(ctx: Context) -> None:
    console.rule(f"Status ({ctx.env.name})")
    outputs = terraform_output(ctx)
    rows = []
    for key in (
        "environment",
        "account_id",
        "region",
        "api_url",
        "lambda_url",
        "ecr_repository_url",
        "history_bucket",
        "uploads_bucket",
        "secret_arn",
        "api_function_name",
        "llm_function_name",
        "api_log_group",
        "llm_log_group",
        "db_address",
    ):
        value = outputs.get(key)
        if value:
            rows.append((key, str(value)))
    rows.append(("pages_url", ctx.env.pages_origin))
    rows.append(("public_url", ctx.env.public_origin))
    console.kv_table("Stack", rows)
    api_url = _resolve_api_url(ctx, outputs)
    site_origins = _site_origins(ctx)
    if api_url:
        _probe_health(ctx, api_url)
        for origin in site_origins:
            if origin.startswith("http://"):
                continue
            _check_cors(ctx, api_url, origin)
        _check_ui_endpoint(ctx, ctx.env.public_origin, api_url)
        if ctx.env.public_origin != ctx.env.pages_origin:
            _check_ui_endpoint(ctx, ctx.env.pages_origin, api_url)
    bucket = str(outputs.get("uploads_bucket") or outputs.get("history_bucket") or "")
    if bucket:
        for origin in site_origins:
            if origin.startswith("http://"):
                continue
            _check_s3_cors(ctx, bucket, origin, "GET")
            _check_s3_cors(ctx, bucket, origin, "PUT")


def logs(ctx: Context) -> None:
    """Pull CloudWatch logs from the remote API and/or LLM Lambda."""
    require_cmd("aws")
    console.rule(f"Lambda logs ({ctx.env.name})")
    which = (ctx.extras.get("function") or "").strip().lower()
    if which not in {"api", "llm", "both"}:
        which = console.select(
            "Which Lambda?",
            [
                console.Choice("api", "API", "fileworks-<env>-api — FastAPI / convert"),
                console.Choice("llm", "LLM worker", "fileworks-<env>-llm — vision + translation"),
                console.Choice("both", "Both", "snapshot of LLM, then live-tail API"),
            ],
            default="api",
        )
    since = (ctx.extras.get("since") or "1h").strip() or "1h"
    follow_flag = ctx.extras.get("follow")
    if follow_flag is not None:
        follow = follow_flag in {"1", "true", "yes"}
    else:
        follow = True
    outputs = terraform_output(ctx)
    groups = resolve_lambda_log_groups(
        ctx.env.name,
        which,
        api_function_name=str(outputs.get("api_function_name") or ""),
        llm_function_name=str(outputs.get("llm_function_name") or ""),
        api_log_group=str(outputs.get("api_log_group") or ""),
        llm_log_group=str(outputs.get("llm_log_group") or ""),
    )
    if follow and len(groups) > 1:
        console.info("Live tail is one log group at a time — snapshot of LLM, then following API.")
    snapshots = groups if not follow else groups[1:]
    live = groups[:1] if follow else []
    for label, group in snapshots:
        console.info(f"{label}: {group}  (since {since})")
        run(lambda_logs_tail_args(group, since=since, follow=False, region=ctx.region), ctx=ctx)
    if live:
        label, group = live[0]
        console.info(f"Following {label}: {group}  (since {since}, Ctrl-C to stop)")
        run(lambda_logs_tail_args(group, since=since, follow=True, region=ctx.region), ctx=ctx)


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


def _site_origins(ctx: Context, parsed: dict[str, str] | None = None) -> list[str]:
    values = parsed if parsed is not None else _parse_dotenv_for(ctx)
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        ctx.env.pages_origin,
        ctx.env.public_origin,
        resolve_public_api_url(values.get("PUBLIC_APP_URL", "")),
    ]
    unique: list[str] = []
    for origin in origins:
        if origin and origin not in unique:
            unique.append(origin)
    return unique


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


API_PROXY_CONFIG = ROOT_DIR / "infra" / "cloudflare" / "api-proxy" / "wrangler.jsonc"


def _deploy_api_proxy(ctx: Context, outputs: dict) -> None:
    """Proxy the custom API host to the Function URL so TLS and Host headers work."""
    public = _resolve_api_url(ctx, outputs)
    origin = str(outputs.get("lambda_url") or "").rstrip("/")
    if not public or not origin or not ctx.env.api_origin:
        return
    if is_lambda_function_url(public):
        return
    if not API_PROXY_CONFIG.is_file():
        raise CommandError(f"API proxy config missing: {API_PROXY_CONFIG}")
    console.info(f"Publishing API proxy {public} → {origin}")
    wrangler(
        ctx,
        "deploy",
        "--config",
        str(API_PROXY_CONFIG),
        "--env",
        ctx.env.name,
        "--var",
        f"ORIGIN:{origin}",
    )
    console.success(f"API proxy published → {public}")


def _resolve_api_url(ctx: Context, outputs: dict) -> str:
    """Public API origin. Never pin the UI to a raw Lambda URL when a custom host exists."""
    parsed = _parse_dotenv_for(ctx)
    return resolve_public_api_url(
        parsed.get("PUBLIC_API_URL", ""),
        ctx.env.api_origin,
        str(outputs.get("api_url") or ""),
        str(outputs.get("lambda_url") or ""),
    )


def _write_runtime_config(out_dir: Path, api_url: str, canonical_origin: str) -> None:
    """Point the built UI at the API without rebuilding any JS bundle."""
    payload = json.dumps({"apiUrl": api_url, "canonicalOrigin": canonical_origin})
    (out_dir / "config.js").write_text(
        "// Written by `fw frontend` from PUBLIC_API_URL or Terraform api_url.\n"
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
    """The browser talks to S3 directly, so the app bucket needs CORS for GET and PUT.

    Uploads PUT under upload/files/ and history previews GET a presigned URL under
    history/. Neither goes through the API, so an out-of-date bucket rule is invisible
    to the API preflight check above and only shows up as a failed click.
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
    api_url = _resolve_api_url(ctx, outputs)
    if not api_url:
        raise CommandError("api_url missing — apply the AWS stack first.")

    who = wrangler(ctx, "whoami", check=False, capture=True)
    if who.returncode != 0:
        console.warn("Not logged into Cloudflare. Opening `wrangler login`…")
        wrangler(ctx, "login")
    _deploy_api_proxy(ctx, outputs)

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
    # Sync deps before build — wrangler alone can leave node_modules stale.
    ensure_frontend_deps()
    run(
        ["npm", "run", "build"],
        cwd=FRONTEND_DIR,
        env=frontend_env,
        ctx=ctx,
    )
    out_dir = FRONTEND_DIR / "out"
    if not out_dir.is_dir():
        raise CommandError("frontend/out missing after build — static export failed.")
    canonical = resolve_public_api_url(parsed.get("PUBLIC_APP_URL", ""), ctx.env.public_origin)
    _write_runtime_config(out_dir, api_url, canonical)

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
    frontend_url = canonical
    if not ctx.env.is_production:
        _write_local_cors(ctx, _site_origins(ctx, parsed))
        console.info("Updating API + S3 CORS for the public site and Pages origins.")
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
    for origin in (frontend_url, ctx.env.pages_origin):
        _check_cors(ctx, api_url, origin)


def full(ctx: Context) -> None:
    console.rule(f"Full deploy ({ctx.env.name})")
    console.info("Order: AWS Lambda API → Cloudflare Pages UI")
    if not ctx.auto_yes and not console.confirm(
        f"Run the full {ctx.env.name} pipeline?", default=not ctx.env.is_production
    ):
        console.warn("Cancelled.")
        return
    bootstrap(ctx)
    try:
        request_lambda_quota(ctx)
    except CommandError as exc:
        console.warn(str(exc))
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
