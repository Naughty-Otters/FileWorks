"""Admin API — inspect users and override workspace / API plans."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.auth.admin import require_admin
from app.auth.api_plans import API_CHANGEABLE_PLANS, get_api_plan
from app.auth.deps import Principal, get_principal
from app.auth.plans import CHANGEABLE_PLANS, get_plan
from app.auth.quota import api_quota_snapshot, quota_snapshot
from app.db.models import ApiKey, HistoryDocument, UsageEvent, User, UserTemplate
from app.db.session import get_db

router = APIRouter(prefix="/admin", tags=["admin"])
PrincipalDep = Annotated[Principal, Depends(get_principal)]
DatabaseDep = Annotated[Session | None, Depends(get_db)]


class AdminUserSummary(BaseModel):
    id: str
    email: str
    name: str | None
    plan: str
    api_plan: str
    stripe_customer_id: str | None
    stripe_subscription_id: str | None
    stripe_api_subscription_id: str | None
    history_indexed: bool
    created_at: datetime | None
    updated_at: datetime | None
    usage_events: int = 0
    api_keys: int = 0
    history_documents: int = 0
    templates: int = 0


class AdminUserDetail(AdminUserSummary):
    picture_url: str | None = None
    google_sub: str | None = None
    quota: dict[str, Any] = Field(default_factory=dict)
    api_quota: dict[str, Any] = Field(default_factory=dict)


class AdminUserListResponse(BaseModel):
    items: list[AdminUserSummary]
    total: int
    limit: int
    offset: int


class AdminOverviewResponse(BaseModel):
    users: int
    usage_events: int
    api_keys: int
    history_documents: int
    templates: int
    plans: dict[str, int]
    api_plans: dict[str, int]


class AdminUserUpdate(BaseModel):
    plan: str | None = None
    api_plan: str | None = None


class AdminPlanOptions(BaseModel):
    workspace_plans: list[dict[str, str]]
    api_plans: list[dict[str, str]]


def _db(session: Session | None) -> Session:
    if session is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    return session


def _count_for(db: Session, model: type, user_id: UUID) -> int:
    return int(
        db.scalar(select(func.count()).select_from(model).where(model.user_id == user_id)) or 0
    )


def _summary(db: Session, user: User) -> AdminUserSummary:
    return AdminUserSummary(
        id=str(user.id),
        email=user.email,
        name=user.name,
        plan=user.plan,
        api_plan=user.api_plan,
        stripe_customer_id=user.stripe_customer_id,
        stripe_subscription_id=user.stripe_subscription_id,
        stripe_api_subscription_id=user.stripe_api_subscription_id,
        history_indexed=bool(user.history_indexed),
        created_at=user.created_at,
        updated_at=user.updated_at,
        usage_events=_count_for(db, UsageEvent, user.id),
        api_keys=int(
            db.scalar(
                select(func.count())
                .select_from(ApiKey)
                .where(ApiKey.user_id == user.id, ApiKey.revoked_at.is_(None))
            )
            or 0
        ),
        history_documents=_count_for(db, HistoryDocument, user.id),
        templates=_count_for(db, UserTemplate, user.id),
    )


def _detail(db: Session, user: User) -> AdminUserDetail:
    base = _summary(db, user)
    plan = get_plan(user.plan)
    api_plan = get_api_plan(user.api_plan)
    return AdminUserDetail(
        **base.model_dump(),
        picture_url=user.picture_url,
        google_sub=user.google_sub,
        quota=quota_snapshot(db, user_id=user.id, plan=plan),
        api_quota=api_quota_snapshot(db, user_id=user.id, plan=api_plan),
    )


@router.get("/overview", response_model=AdminOverviewResponse)
def admin_overview(principal: PrincipalDep, db: DatabaseDep) -> AdminOverviewResponse:
    require_admin(principal)
    session = _db(db)
    plan_rows = session.execute(select(User.plan, func.count()).group_by(User.plan)).all()
    api_rows = session.execute(select(User.api_plan, func.count()).group_by(User.api_plan)).all()
    return AdminOverviewResponse(
        users=int(session.scalar(select(func.count()).select_from(User)) or 0),
        usage_events=int(session.scalar(select(func.count()).select_from(UsageEvent)) or 0),
        api_keys=int(
            session.scalar(
                select(func.count()).select_from(ApiKey).where(ApiKey.revoked_at.is_(None))
            )
            or 0
        ),
        history_documents=int(session.scalar(select(func.count()).select_from(HistoryDocument)) or 0),
        templates=int(session.scalar(select(func.count()).select_from(UserTemplate)) or 0),
        plans={str(plan): int(count) for plan, count in plan_rows},
        api_plans={str(plan): int(count) for plan, count in api_rows},
    )


@router.get("/plans", response_model=AdminPlanOptions)
def admin_plans(principal: PrincipalDep) -> AdminPlanOptions:
    require_admin(principal)
    return AdminPlanOptions(
        workspace_plans=[
            {"id": plan_id, "label": get_plan(plan_id).label} for plan_id in sorted(CHANGEABLE_PLANS)
        ],
        api_plans=[
            {"id": plan_id, "label": get_api_plan(plan_id).label}
            for plan_id in sorted(API_CHANGEABLE_PLANS)
        ],
    )


@router.get("/users", response_model=AdminUserListResponse)
def list_users(
    principal: PrincipalDep,
    db: DatabaseDep,
    q: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> AdminUserListResponse:
    require_admin(principal)
    session = _db(db)
    stmt = select(User).order_by(User.created_at.desc())
    count_stmt = select(func.count()).select_from(User)
    needle = (q or "").strip()
    if needle:
        pattern = f"%{needle}%"
        filt = or_(User.email.ilike(pattern), User.name.ilike(pattern))
        stmt = stmt.where(filt)
        count_stmt = count_stmt.where(filt)
    total = int(session.scalar(count_stmt) or 0)
    rows = session.scalars(stmt.offset(offset).limit(limit)).all()
    return AdminUserListResponse(
        items=[_summary(session, row) for row in rows if isinstance(row, User)],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/users/{user_id}", response_model=AdminUserDetail)
def get_user(user_id: UUID, principal: PrincipalDep, db: DatabaseDep) -> AdminUserDetail:
    require_admin(principal)
    session = _db(db)
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return _detail(session, user)


@router.patch("/users/{user_id}", response_model=AdminUserDetail)
def update_user(
    user_id: UUID,
    body: AdminUserUpdate,
    principal: PrincipalDep,
    db: DatabaseDep,
) -> AdminUserDetail:
    """Override workspace / API plan without Stripe or usage gates."""
    require_admin(principal)
    session = _db(db)
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if body.plan is None and body.api_plan is None:
        raise HTTPException(status_code=400, detail="Provide plan and/or api_plan")
    if body.plan is not None:
        target = body.plan.strip().lower()
        if target not in CHANGEABLE_PLANS:
            raise HTTPException(status_code=400, detail=f"Invalid plan: {target}")
        user.plan = target
    if body.api_plan is not None:
        target_api = body.api_plan.strip().lower()
        if target_api not in API_CHANGEABLE_PLANS:
            raise HTTPException(status_code=400, detail=f"Invalid api_plan: {target_api}")
        user.api_plan = target_api
    session.add(user)
    session.flush()
    return _detail(session, user)
