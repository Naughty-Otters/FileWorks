"""AWS profile discovery and STS identity (CLI, no boto3 required)."""

from __future__ import annotations

import json
import subprocess

from fw.context import DEFAULT_REGION, Session
from fw.tools import child_env


def list_profiles() -> list[str]:
    result = subprocess.run(
        ["aws", "configure", "list-profiles"],
        capture_output=True,
        text=True,
        check=False,
        env=child_env(),
    )
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def build_session(profile: str | None, region: str) -> Session:
    env = child_env(profile=profile, region=region or DEFAULT_REGION)
    result = subprocess.run(
        ["aws", "sts", "get-caller-identity", "--output", "json", "--region", region or DEFAULT_REGION],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "sts get-caller-identity failed").strip())
    identity = json.loads(result.stdout)
    return Session(
        profile=profile,
        region=region or DEFAULT_REGION,
        account_id=str(identity.get("Account") or ""),
        arn=str(identity.get("Arn") or ""),
    )


def try_build_session(profile: str | None, region: str) -> tuple[Session | None, str | None]:
    try:
        return build_session(profile, region), None
    except (RuntimeError, json.JSONDecodeError, OSError) as exc:
        return None, str(exc)
