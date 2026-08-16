from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.deps import Principal, get_principal
from app.billing.stripe import (
    billing_catalog,
    confirm_checkout_session,
    construct_webhook_event,
    create_checkout_session,
    create_portal_session,
    handle_webhook_event,
    sync_user_subscription,
)
from app.db.models import User
from app.db.session import get_db

router = APIRouter(tags=["billing"])


class CheckoutRequest(BaseModel):
    plan: str
    return_to: str | None = None


class CheckoutResponse(BaseModel):
    url: str | None = None
    updated: bool = False
    plan: str | None = None


class ConfirmRequest(BaseModel):
    session_id: str


class ConfirmResponse(BaseModel):
    plan: str | None = None
    api_plan: str | None = None


class CatalogApiBucket(BaseModel):
    amounts: dict[str, int]
    prices: dict[str, bool]


class CatalogResponse(BaseModel):
    enabled: bool
    currency: str = "usd"
    amounts: dict[str, int]
    prices: dict[str, bool]
    api: CatalogApiBucket


class PortalResponse(BaseModel):
    url: str


class SyncResponse(BaseModel):
    plan: str | None = None
    subscription_status: str | None = None
    cancel_at_period_end: bool = False
    current_period_end: str | None = None
    api_plan: str | None = None
    api_subscription_status: str | None = None
    api_cancel_at_period_end: bool = False
    api_current_period_end: str | None = None


def _require_user(principal: Principal, db: Session | None) -> User:
    if db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    if principal.user is None:
        raise HTTPException(status_code=401, detail="Sign in to manage billing")
    user = db.get(User, principal.user.id)
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@router.get("/billing/catalog", response_model=CatalogResponse)
def catalog() -> CatalogResponse:
    return CatalogResponse(**billing_catalog())


@router.post("/billing/checkout", response_model=CheckoutResponse)
def start_checkout(
    body: CheckoutRequest,
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> CheckoutResponse:
    user = _require_user(principal, db)
    return CheckoutResponse(**create_checkout_session(db, user, body.plan, return_to=body.return_to))


@router.post("/billing/confirm", response_model=ConfirmResponse)
def confirm_checkout(
    body: ConfirmRequest,
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> ConfirmResponse:
    user = _require_user(principal, db)
    assigned = confirm_checkout_session(db, user, body.session_id)
    return ConfirmResponse(plan=user.plan, api_plan=user.api_plan or assigned)


@router.post("/billing/portal", response_model=PortalResponse)
def billing_portal(
    product: str = "workspace",
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> PortalResponse:
    user = _require_user(principal, db)
    return PortalResponse(**create_portal_session(db, user, product=product))


@router.post("/billing/sync", response_model=SyncResponse)
def sync_billing(
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> SyncResponse:
    user = _require_user(principal, db)
    view = sync_user_subscription(db, user)
    return SyncResponse(
        plan=user.plan,
        api_plan=user.api_plan,
        subscription_status=view.get("subscription_status"),
        cancel_at_period_end=bool(view.get("cancel_at_period_end")),
        current_period_end=view.get("current_period_end"),
        api_subscription_status=view.get("api_subscription_status"),
        api_cancel_at_period_end=bool(view.get("api_cancel_at_period_end")),
        api_current_period_end=view.get("api_current_period_end"),
    )


@router.post("/billing/webhook")
async def stripe_webhook(request: Request, db: Session | None = Depends(get_db)) -> dict[str, str]:
    if db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    event = construct_webhook_event(await request.body(), request.headers.get("stripe-signature"))
    handle_webhook_event(db, event)
    return {"status": "ok"}
