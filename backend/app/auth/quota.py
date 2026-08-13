from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.plans import Plan
from app.db.models import UsageEvent

EXTRACT_ACTION = "extract"
AI_ACTION = "extract.ai"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _period_bounds() -> tuple[datetime, datetime]:
    now = _utcnow()
    start_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    start_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return start_day, start_month


def _count(db: Session | None, user_id: UUID | None, action: str, since: datetime) -> int:
    if db is None or user_id is None:
        return 0
    return int(
        db.scalar(
            select(func.count()).select_from(UsageEvent).where(
                UsageEvent.user_id == user_id,
                UsageEvent.action == action,
                UsageEvent.created_at >= since,
            )
        )
        or 0
    )


def _remaining(limit: int | None, used: int) -> int | None:
    return None if limit is None else max(0, limit - used)


def quota_snapshot(db: Session | None, *, user_id: UUID | None, plan: Plan) -> dict[str, int | None]:
    start_day, start_month = _period_bounds()
    used_day = _count(db, user_id, EXTRACT_ACTION, start_day)
    used_month = _count(db, user_id, EXTRACT_ACTION, start_month)
    used_ai_day = _count(db, user_id, AI_ACTION, start_day)
    used_ai_month = _count(db, user_id, AI_ACTION, start_month)
    return {
        "used_day": used_day,
        "used_month": used_month,
        "limit_day": plan.extracts_per_day,
        "limit_month": plan.extracts_per_month,
        "remaining_day": _remaining(plan.extracts_per_day, used_day),
        "remaining_month": _remaining(plan.extracts_per_month, used_month),
        "used_ai_day": used_ai_day,
        "used_ai_month": used_ai_month,
        "limit_ai_day": plan.ai_per_day,
        "limit_ai_month": plan.ai_per_month,
        "remaining_ai_day": _remaining(plan.ai_per_day, used_ai_day),
        "remaining_ai_month": _remaining(plan.ai_per_month, used_ai_month),
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


def assert_can_use_ai(
    db: Session | None,
    *,
    user_id: UUID | None,
    plan: Plan,
    use_ai: bool,
    translate: bool,
) -> None:
    if not use_ai and not translate:
        return
    if use_ai and not plan.ai:
        raise HTTPException(
            status_code=403,
            detail={"code": "plan_forbidden", "feature": "extract.ai", "plan": plan.id},
        )
    if translate and not plan.translate:
        raise HTTPException(
            status_code=403,
            detail={"code": "plan_forbidden", "feature": "extract.translate", "plan": plan.id},
        )
    snap = quota_snapshot(db, user_id=user_id, plan=plan)
    if snap["remaining_ai_day"] == 0:
        raise HTTPException(
            status_code=403,
            detail={"code": "quota_ai_day", "plan": plan.id, "limit": plan.ai_per_day},
        )
    if snap["remaining_ai_month"] == 0:
        raise HTTPException(
            status_code=403,
            detail={"code": "quota_ai_month", "plan": plan.id, "limit": plan.ai_per_month},
        )


def record_extract(
    db: Session | None,
    *,
    user_id: UUID | None,
    anonymous_id: str | None,
    enhanced: bool = False,
) -> None:
    if db is None:
        return
    db.add(UsageEvent(user_id=user_id, anonymous_id=anonymous_id, action=EXTRACT_ACTION))
    if enhanced:
        db.add(UsageEvent(user_id=user_id, anonymous_id=anonymous_id, action=AI_ACTION))
