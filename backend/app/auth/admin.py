"""Hard-gated admin access.

Only kenny.zlee@gmail.com may use /api/admin. Product plans (Casual / Daily /
Expert) are not privileges — admin is an email allowlist of one.
"""

from __future__ import annotations

from fastapi import HTTPException

from app.auth.deps import Principal
from app.db.models import User

ADMIN_EMAIL = "kenny.zlee@gmail.com"


def normalize_email(email: str | None) -> str:
    return (email or "").strip().lower()


def is_admin_email(email: str | None) -> bool:
    return normalize_email(email) == ADMIN_EMAIL


def is_admin_user(user: User | None) -> bool:
    return user is not None and is_admin_email(user.email)


def require_admin(principal: Principal) -> User:
    if principal.user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    if not is_admin_user(principal.user):
        raise HTTPException(status_code=403, detail="Admin access required")
    return principal.user
