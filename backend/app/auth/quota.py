from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.plans import Plan
from app.db.models import UsageEvent


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def quota_snapshot(db: Session | None, *, user_id: UUID | None, plan: Plan) -> dict[str, int | None]:
    used_day = 0
    used_month = 0
    if db is not None and user_id is not None:
        now = _utcnow()
        start_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        start_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        used_day = int(
            db.scalar(
                select(func.count()).select_from(UsageEvent).where(
                    UsageEvent.user_id == user_id,
                    UsageEvent.action == "extract",
                    UsageEvent.created_at >= start_day,
                )
            )
            or 0
        )
        used_month = int(
            db.scalar(
                select(func.count()).select_from(UsageEvent).where(
                    UsageEvent.user_id == user_id,
                    UsageEvent.action == "extract",
                    UsageEvent.created_at >= start_month,
                )
            )
            or 0
        )
    remaining_day = None if plan.extracts_per_day is None else max(0, plan.extracts_per_day - used_day)
    remaining_month = (
        None if plan.extracts_per_month is None else max(0, plan.extracts_per_month - used_month)
    )
    return {
        "used_day": used_day,
        "used_month": used_month,
        "limit_day": plan.extracts_per_day,
        "limit_month": plan.extracts_per_month,
        "remaining_day": remaining_day,
        "remaining_month": remaining_month,
    }


def assert_can_extract(db: Session | None, *, user_id: UUID | None, plan: Plan) -> None:
    if not plan.extract:
        raise HTTPException(status_code=403, detail={"code": "plan_forbidden", "feature": "extract"})
    snap = quota_snapshot(db, user_id=user_id, plan=plan)
    if snap["remaining_day"] == 0:
        raise HTTPException(
            status_code=403,
            detail={"code": "quota_day", "plan": plan.id, "limit": plan.extracts_per_day},
        )
    if snap["remaining_month"] == 0:
        raise HTTPException(
            status_code=403,
            detail={"code": "quota_month", "plan": plan.id, "limit": plan.extracts_per_month},
        )


def record_extract(db: Session | None, *, user_id: UUID | None, anonymous_id: str | None) -> None:
    if db is None:
        return
    db.add(UsageEvent(user_id=user_id, anonymous_id=anonymous_id, action="extract"))
