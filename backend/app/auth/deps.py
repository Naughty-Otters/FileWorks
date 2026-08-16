from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth.api_keys import looks_like_api_key, lookup_api_key, touch_api_key
from app.auth.api_plans import ApiPlan, get_api_plan
from app.auth.plans import Plan, get_plan, permissions_for
from app.auth.tokens import decode_access_token
from app.db.models import ApiKey, User
from app.db.session import get_db


@dataclass
class Principal:
    plan: Plan
    user: User | None = None
    anonymous_id: str | None = None
    api_plan: ApiPlan | None = None
    api_key: ApiKey | None = None
    via_api_key: bool = False

    @property
    def user_id(self) -> UUID | None:
        return None if self.user is None else self.user.id

    def permissions(self) -> dict[str, bool]:
        return permissions_for(self.plan)


def _credential_from_request(request: Request) -> str:
    """Bearer token, raw fw_live_ key, or X-Api-Key."""
    header = (request.headers.get("authorization") or "").strip()
    if header.lower().startswith("bearer "):
        return header.split(" ", 1)[1].strip()
    if looks_like_api_key(header):
        return header
    return (request.headers.get("x-api-key") or "").strip()


def _principal_from_api_key(db: Session | None, raw: str) -> Principal:
    if db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    key = lookup_api_key(db, raw)
    if key is None:
        raise HTTPException(status_code=401, detail="API key expired or invalid")
    user = db.get(User, key.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    touch_api_key(key)
    return Principal(
        plan=get_plan(user.plan),
        user=user,
        api_plan=get_api_plan(getattr(user, "api_plan", None)),
        api_key=key,
        via_api_key=True,
    )


def get_principal(request: Request, db: Session | None = Depends(get_db)) -> Principal:
    raw = _credential_from_request(request)
    if looks_like_api_key(raw):
        return _principal_from_api_key(db, raw)
    if raw:
        try:
            payload = decode_access_token(raw)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=401, detail="Access token expired or invalid") from exc
        if db is None:
            raise HTTPException(status_code=503, detail="Database is not configured")
        user = db.get(User, UUID(str(payload["sub"])))
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return Principal(
            plan=get_plan(user.plan),
            user=user,
            api_plan=get_api_plan(getattr(user, "api_plan", None)),
        )
    return Principal(plan=get_plan("anonymous"), anonymous_id=request.headers.get("x-anonymous-id"))
