from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.plans import PLAN_RANK, Plan, can_change_plan, get_plan
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
    scalar = getattr(db, "scalar", None)
    if not callable(scalar):
        return 0
    return int(
        scalar(
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


def usage_over_limit(
    plan: Plan,
    *,
    used_day: int,
    used_month: int,
    used_ai_day: int,
    used_ai_month: int,
) -> list[str]:
    """Return limit keys that current usage already exceeds on `plan`."""
    over: list[str] = []
    if plan.extracts_per_day is not None and used_day > plan.extracts_per_day:
        over.append("extracts_day")
    if plan.extracts_per_month is not None and used_month > plan.extracts_per_month:
        over.append("extracts_month")
    if plan.ai_per_day is not None and used_ai_day > plan.ai_per_day:
        over.append("ai_day")
    if plan.ai_per_month is not None and used_ai_month > plan.ai_per_month:
        over.append("ai_month")
    return over


def usage_fits_plan(db: Session | None, *, user_id: UUID | None, plan: Plan) -> bool:
    snap = quota_snapshot(db, user_id=user_id, plan=plan)
    return not usage_over_limit(
        plan,
        used_day=int(snap["used_day"] or 0),
        used_month=int(snap["used_month"] or 0),
        used_ai_day=int(snap["used_ai_day"] or 0),
        used_ai_month=int(snap["used_ai_month"] or 0),
    )


def assert_can_switch_to_plan(
    db: Session | None,
    *,
    user_id: UUID | None,
    current: str,
    target: str,
) -> None:
    if not can_change_plan(current, target):
        raise HTTPException(
            status_code=400,
            detail={"code": "plan_invalid", "current": current, "target": target},
        )
    if PLAN_RANK.get(target, 0) >= PLAN_RANK.get(current, 0):
        return
    plan = get_plan(target)
    snap = quota_snapshot(db, user_id=user_id, plan=plan)
    over = usage_over_limit(
        plan,
        used_day=int(snap["used_day"] or 0),
        used_month=int(snap["used_month"] or 0),
        used_ai_day=int(snap["used_ai_day"] or 0),
        used_ai_month=int(snap["used_ai_month"] or 0),
    )
    if over:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "quota_exceeds_plan",
                "current": current,
                "target": target,
                "limits": over,
                "used": {
                    "day": snap["used_day"],
                    "month": snap["used_month"],
                    "ai_day": snap["used_ai_day"],
                    "ai_month": snap["used_ai_month"],
                },
            },
        )


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
