"""AWS profile discovery and STS identity (CLI, no boto3 required)."""

from fw.aws.session import build_session, list_profiles, try_build_session

__all__ = ["build_session", "list_profiles", "try_build_session"]
