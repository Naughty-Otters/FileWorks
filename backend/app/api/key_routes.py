from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.auth.api_keys import create_api_key, list_api_keys, public_key_row, revoke_api_key
from app.auth.api_plans import get_api_plan
from app.auth.deps import Principal, get_principal
from app.db.models import User
from app.db.session import get_db

router = APIRouter(tags=["api keys"])


class CreateKeyRequest(BaseModel):
    name: str | None = Field(default=None, max_length=64)


class ApiKeyPublic(BaseModel):
    id: str
    name: str
    prefix: str
    last4: str
    created_at: str | None = None
    last_used_at: str | None = None


class CreatedApiKey(ApiKeyPublic):
    token: str


def _require_user(principal: Principal, db: Session | None) -> User:
    if db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    if principal.user is None:
        raise HTTPException(status_code=401, detail="Sign in to manage API keys")
    user = db.get(User, principal.user.id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@router.get("/keys", response_model=list[ApiKeyPublic])
def list_keys(
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> list[ApiKeyPublic]:
    user = _require_user(principal, db)
    return [ApiKeyPublic(**public_key_row(row)) for row in list_api_keys(db, user.id)]


@router.post("/keys", response_model=CreatedApiKey)
def create_key(
    body: CreateKeyRequest,
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> CreatedApiKey:
    user = _require_user(principal, db)
    row, secret = create_api_key(
        db,
        user_id=user.id,
        plan=get_api_plan(user.api_plan),
        name=body.name,
    )
    payload = public_key_row(row)
    return CreatedApiKey(**payload, token=secret)


@router.delete("/keys/{key_id}")
def delete_key(
    key_id: UUID,
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> dict[str, str]:
    user = _require_user(principal, db)
    revoke_api_key(db, user_id=user.id, key_id=key_id)
    return {"status": "ok"}
