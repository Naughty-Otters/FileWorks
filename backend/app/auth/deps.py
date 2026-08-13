from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.auth.plans import Plan, get_plan, permissions_for
from app.auth.tokens import decode_access_token
from app.db.models import User
from app.db.session import get_db


@dataclass
class Principal:
    plan: Plan
    user: User | None = None
    anonymous_id: str | None = None

    @property
    def user_id(self) -> UUID | None:
        return None if self.user is None else self.user.id

    def permissions(self) -> dict[str, bool]:
        return permissions_for(self.plan)


def get_principal(request: Request, db: Session | None = Depends(get_db)) -> Principal:
    header = request.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        raw = header.split(" ", 1)[1].strip()
        try:
            payload = decode_access_token(raw)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=401, detail="Access token expired or invalid") from exc
        if db is None:
            raise HTTPException(status_code=503, detail="Database is not configured")
        user = db.get(User, UUID(str(payload["sub"])))
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        return Principal(plan=get_plan(user.plan), user=user)
    return Principal(plan=get_plan("anonymous"), anonymous_id=request.headers.get("x-anonymous-id"))
