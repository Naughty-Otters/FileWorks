from __future__ import annotations

import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.api_plans import ApiPlan
from app.auth.tokens import hash_token
from app.db.models import ApiKey

API_KEY_PREFIX = "fw_live_"
MAX_KEY_NAME = 64


def new_api_key_secret() -> str:
    return f"{API_KEY_PREFIX}{secrets.token_urlsafe(32)}"


def looks_like_api_key(raw: str) -> bool:
    return raw.startswith(API_KEY_PREFIX)


def _display_parts(secret: str) -> tuple[str, str]:
    prefix = secret[:12]
    last4 = secret[-4:]
    return prefix, last4


def public_key_row(row: ApiKey) -> dict[str, str | None]:
    return {
        "id": str(row.id),
        "name": row.name,
        "prefix": row.prefix,
        "last4": row.last4,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
    }


def _active_count(db: Session, user_id: UUID) -> int:
    return int(
        db.scalar(
            select(func.count())
            .select_from(ApiKey)
            .where(ApiKey.user_id == user_id, ApiKey.revoked_at.is_(None))
        )
        or 0
    )


def list_api_keys(db: Session, user_id: UUID) -> list[ApiKey]:
    return list(
        db.scalars(
            select(ApiKey)
            .where(ApiKey.user_id == user_id, ApiKey.revoked_at.is_(None))
            .order_by(ApiKey.created_at.desc())
        ).all()
    )


def create_api_key(
    db: Session,
    *,
    user_id: UUID,
    plan: ApiPlan,
    name: str | None = None,
) -> tuple[ApiKey, str]:
    if _active_count(db, user_id) >= plan.max_keys:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "api_key_limit",
                "plan": plan.id,
                "limit": plan.max_keys,
            },
        )
    label = (name or "").strip() or "API key"
    if len(label) > MAX_KEY_NAME:
        raise HTTPException(status_code=400, detail={"code": "api_key_name", "max": MAX_KEY_NAME})
    secret = new_api_key_secret()
    prefix, last4 = _display_parts(secret)
    row = ApiKey(
        user_id=user_id,
        name=label,
        prefix=prefix,
        last4=last4,
        token_hash=hash_token(secret),
    )
    db.add(row)
    db.flush()
    return row, secret


def revoke_api_key(db: Session, *, user_id: UUID, key_id: UUID) -> None:
    row = db.get(ApiKey, key_id)
    if row is None or row.user_id != user_id or row.revoked_at is not None:
        raise HTTPException(status_code=404, detail="API key not found")
    row.revoked_at = datetime.now(timezone.utc)
    db.add(row)


def lookup_api_key(db: Session, secret: str) -> ApiKey | None:
    digest = hash_token(secret)
    row = db.scalar(
        select(ApiKey).where(ApiKey.token_hash == digest, ApiKey.revoked_at.is_(None))
    )
    return row


def touch_api_key(row: ApiKey) -> None:
    row.last_used_at = datetime.now(timezone.utc)
