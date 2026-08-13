from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import Principal, get_principal
from app.auth.google import verify_google_id_token
from app.auth.plans import get_plan, permissions_for
from app.auth.quota import quota_snapshot
from app.auth.tokens import hash_token, issue_access_token, new_refresh_token
from app.core.config import get_settings
from app.db.models import RefreshToken, User
from app.db.session import get_db

router = APIRouter(tags=["auth"])


class GoogleLoginRequest(BaseModel):
    id_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict
    plan: str
    permissions: dict[str, bool]


class RefreshRequest(BaseModel):
    refresh_token: str


class MeResponse(BaseModel):
    user: dict | None
    plan: str
    permissions: dict[str, bool]
    quota: dict
    google_client_id: str | None = None


def _user_public(user: User) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "name": user.name,
        "picture_url": user.picture_url,
        "plan": user.plan,
    }


def _issue_pair(db: Session, user: User) -> TokenResponse:
    settings = get_settings()
    access = issue_access_token(user_id=user.id, plan=user.plan, email=user.email)
    refresh = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=hash_token(refresh),
            expires_at=datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_ttl_days),
        )
    )
    db.flush()
    plan = get_plan(user.plan)
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=settings.access_token_ttl_s,
        user=_user_public(user),
        plan=user.plan,
        permissions=permissions_for(plan),
    )


@router.post("/auth/google", response_model=TokenResponse)
def login_google(body: GoogleLoginRequest, db: Session | None = Depends(get_db)) -> TokenResponse:
    if db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    try:
        claims = verify_google_id_token(body.id_token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {exc}") from exc
    sub = str(claims.get("sub") or "")
    email = str(claims.get("email") or "")
    if not sub or not email:
        raise HTTPException(status_code=401, detail="Google token missing email")
    user = db.scalar(select(User).where(User.google_sub == sub))
    if user is None:
        user = User(
            email=email.lower(),
            google_sub=sub,
            name=claims.get("name"),
            picture_url=claims.get("picture"),
            plan="basic",
        )
        db.add(user)
        db.flush()
    else:
        user.email = email.lower()
        user.name = claims.get("name") or user.name
        user.picture_url = claims.get("picture") or user.picture_url
    return _issue_pair(db, user)


@router.post("/auth/refresh", response_model=TokenResponse)
def refresh_session(body: RefreshRequest, db: Session | None = Depends(get_db)) -> TokenResponse:
    if db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    digest = hash_token(body.refresh_token)
    row = db.scalar(
        select(RefreshToken).where(
            RefreshToken.token_hash == digest,
            RefreshToken.revoked_at.is_(None),
        )
    )
    if row is None or row.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired or invalid")
    row.revoked_at = datetime.now(timezone.utc)
    user = db.get(User, row.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return _issue_pair(db, user)


@router.post("/auth/logout")
def logout(body: RefreshRequest, db: Session | None = Depends(get_db)) -> dict[str, str]:
    if db is None:
        return {"status": "ok"}
    digest = hash_token(body.refresh_token)
    row = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == digest))
    if row is not None:
        row.revoked_at = datetime.now(timezone.utc)
    return {"status": "ok"}


@router.get("/me", response_model=MeResponse)
def me(principal: Principal = Depends(get_principal), db: Session | None = Depends(get_db)) -> MeResponse:
    settings = get_settings()
    return MeResponse(
        user=_user_public(principal.user) if principal.user else None,
        plan=principal.plan.id,
        permissions=principal.permissions(),
        quota=quota_snapshot(db, user_id=principal.user_id, plan=principal.plan),
        google_client_id=settings.google_client_id,
    )
