"""Stripe Checkout / portal / webhooks → FileWorks plan roles."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.plans import CHANGEABLE_PLANS, PLAN_RANK, can_change_plan
from app.core.config import Settings, get_settings
from app.db.models import User

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = frozenset({"active", "trialing", "past_due"})
PENDING_STATUSES = frozenset({"incomplete", "incomplete_expired"})
ENDED_STATUSES = frozenset({"canceled", "unpaid", "incomplete_expired"})
FALLBACK_PLAN = "basic"
DISPLAY_DEFAULTS = {"basic": 0, "pro": 12, "premium": 29}
# Portal: cancel at period end only. No plan switches and no prorated refunds.
PORTAL_CONFIG_KEY = "no_refund_cancel"
PORTAL_FEATURES = {
    "invoice_history": {"enabled": True},
    "payment_method_update": {"enabled": True},
    "subscription_cancel": {
        "enabled": True,
        "mode": "at_period_end",
        "proration_behavior": "none",
    },
    "subscription_update": {
        "enabled": False,
        "default_allowed_updates": [],
        "proration_behavior": "none",
    },
}


def _raw_price(settings: Settings, plan: str) -> str | None:
    value = getattr(settings, f"stripe_price_{plan}", None)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_amount_dollars(raw: str | None) -> int | None:
    if raw is None or raw.startswith("price_"):
        return None
    try:
        return int(raw)
    except ValueError:
        try:
            return int(float(raw))
        except ValueError:
            return None


def stripe_price_id(plan: str, settings: Settings | None = None) -> str | None:
    settings = settings or get_settings()
    raw = _raw_price(settings, plan)
    if raw and raw.startswith("price_"):
        return raw
    return None


def plan_amount_dollars(plan: str, settings: Settings | None = None) -> int:
    settings = settings or get_settings()
    parsed = parse_amount_dollars(_raw_price(settings, plan))
    if parsed is not None:
        return parsed
    return DISPLAY_DEFAULTS.get(plan, 0)


def price_map(settings: Settings | None = None) -> dict[str, str]:
    settings = settings or get_settings()
    return {
        plan: price_id
        for plan in ("basic", "pro", "premium")
        if (price_id := stripe_price_id(plan, settings))
    }


def purchasable_plans(settings: Settings | None = None) -> dict[str, bool]:
    settings = settings or get_settings()
    flags: dict[str, bool] = {}
    for plan in ("basic", "pro", "premium"):
        if stripe_price_id(plan, settings):
            flags[plan] = True
        else:
            flags[plan] = plan_amount_dollars(plan, settings) > 0
    return flags


def stripe_billing_enabled(settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if not settings.stripe_secret_key:
        return False
    return any(purchasable_plans(settings).values())


def billing_catalog(settings: Settings | None = None) -> dict[str, Any]:
    settings = settings or get_settings()
    return {
        "enabled": stripe_billing_enabled(settings),
        "currency": "usd",
        "amounts": {plan: plan_amount_dollars(plan, settings) for plan in ("basic", "pro", "premium")},
        "prices": purchasable_plans(settings),
    }


def billing_status(settings: Settings | None = None) -> dict[str, Any]:
    return billing_catalog(settings)


def plan_for_price(price_id: str | None, settings: Settings | None = None) -> str | None:
    if not price_id:
        return None
    inverted = {price: plan for plan, price in price_map(settings).items()}
    return inverted.get(price_id)


def _stripe_mod(settings: Settings | None = None):
    settings = settings or get_settings()
    try:
        import stripe
    except ImportError as exc:  # pragma: no cover
        raise HTTPException(status_code=503, detail="Stripe is not installed") from exc
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    stripe.api_key = settings.stripe_secret_key
    return stripe


def _app_url(settings: Settings) -> str:
    return settings.public_app_url.rstrip("/")


def _safe_return_path(path: str | None) -> str:
    if path and path.startswith("/") and not path.startswith("//"):
        return path.split("?")[0] or "/profile"
    return "/profile"


def _subscription_price_id(subscription: dict[str, Any]) -> str | None:
    items = (subscription.get("items") or {}).get("data") or []
    if not items:
        return None
    price = items[0].get("price") or {}
    if isinstance(price, str):
        return price
    return price.get("id")


def _plan_from_meta(payload: dict[str, Any]) -> str | None:
    plan = str((payload.get("metadata") or {}).get("plan") or "").strip().lower()
    return plan if plan in CHANGEABLE_PLANS else None


def _subscription_plan(subscription: dict[str, Any], settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return (
        plan_for_price(_subscription_price_id(subscription), settings)
        or _plan_from_meta(subscription)
        or FALLBACK_PLAN
    )


def apply_subscription(user: User, subscription: dict[str, Any], settings: Settings | None = None) -> str:
    """Set user.plan from the Stripe subscription price. Returns the assigned plan."""
    settings = settings or get_settings()
    status = str(subscription.get("status") or "")
    customer = subscription.get("customer")
    if isinstance(customer, dict):
        customer = customer.get("id")
    if customer:
        user.stripe_customer_id = str(customer)
    # Checkout creates an incomplete subscription before payment. Do not demote an existing role.
    if status in PENDING_STATUSES:
        return user.plan
    if status in ACTIVE_STATUSES:
        # cancel_at_period_end stays "active" until the paid period ends.
        user.plan = _subscription_plan(subscription, settings)
        user.stripe_subscription_id = str(subscription.get("id") or "") or None
        return user.plan
    user.plan = FALLBACK_PLAN
    if status in ENDED_STATUSES:
        user.stripe_subscription_id = None
    return user.plan


def _unix_to_iso(value: object) -> str | None:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat()
    return None


def subscription_view(subscription: dict[str, Any] | None) -> dict[str, Any]:
    if not subscription:
        return {
            "subscription_status": None,
            "cancel_at_period_end": False,
            "current_period_end": None,
        }
    end = subscription.get("current_period_end") or subscription.get("cancel_at")
    iso = _unix_to_iso(end)
    if iso is None:
        items = (subscription.get("items") or {}).get("data") or []
        if items:
            iso = _unix_to_iso(items[0].get("current_period_end"))
    return {
        "subscription_status": str(subscription.get("status") or "") or None,
        "cancel_at_period_end": bool(subscription.get("cancel_at_period_end")),
        "current_period_end": iso,
    }


def _prefer_subscription(rows: list[dict[str, Any]], settings: Settings) -> dict[str, Any]:
    def sort_key(row: dict[str, Any]) -> tuple[int, int]:
        keep = 0 if row.get("cancel_at_period_end") else 1
        rank = PLAN_RANK.get(_subscription_plan(row, settings), 0)
        return (keep, rank)

    return max(rows, key=sort_key)


def _list_customer_subscriptions(stripe, customer_id: str) -> list[dict[str, Any]]:
    listed = _as_dict(stripe.Subscription.list(customer=customer_id, status="all", limit=10))
    return [_as_dict(item) for item in listed.get("data") or []]


def _load_subscription(stripe, user: User, settings: Settings) -> dict[str, Any] | None:
    """Return the subscription to apply.

    Raises RuntimeError when Stripe cannot be reached, so callers do not demote a paid role.
    """
    retrieved: dict[str, Any] | None = None
    if user.stripe_subscription_id:
        try:
            retrieved = _as_dict(stripe.Subscription.retrieve(user.stripe_subscription_id))
        except Exception as exc:  # noqa: BLE001
            logger.info("Stripe subscription %s lookup failed: %s", user.stripe_subscription_id, exc)
            retrieved = None

    listed: list[dict[str, Any]] | None = None
    need_list = retrieved is None or str(retrieved.get("status") or "") not in ACTIVE_STATUSES
    if need_list and user.stripe_customer_id:
        try:
            listed = _list_customer_subscriptions(stripe, user.stripe_customer_id)
        except Exception as exc:  # noqa: BLE001
            if retrieved is None:
                raise RuntimeError("Stripe subscription list failed") from exc
            listed = None

    pool = listed if listed is not None else ([retrieved] if retrieved else [])
    active = [row for row in pool if str(row.get("status") or "") in ACTIVE_STATUSES]
    if active:
        return _prefer_subscription(active, settings)
    if retrieved is not None:
        return retrieved
    if listed is not None:
        return listed[0] if listed else None
    raise RuntimeError("Stripe subscription lookup failed")


def sync_user_subscription(db: Session, user: User) -> dict[str, Any]:
    """Pull the Stripe subscription into user.plan so the UI does not wait on webhooks."""
    settings = get_settings()
    if not stripe_billing_enabled(settings):
        return {}
    if not user.stripe_customer_id and not user.stripe_subscription_id:
        return {}
    try:
        stripe = _stripe_mod(settings)
        sub = _load_subscription(stripe, user, settings)
    except Exception:  # noqa: BLE001
        logger.exception("Stripe subscription sync failed")
        return {}
    if sub is None:
        user.plan = FALLBACK_PLAN
        user.stripe_subscription_id = None
        db.add(user)
        return subscription_view(None)
    apply_subscription(user, sub, settings)
    db.add(user)
    return subscription_view(sub)


def _cancel_other_subscriptions(user: User, keep_id: str | None) -> None:
    """Stop superseded subs so a new Checkout does not leave two monthly charges."""
    if not keep_id or not user.stripe_customer_id:
        return
    try:
        stripe = _stripe_mod()
        for row in _list_customer_subscriptions(stripe, user.stripe_customer_id):
            sid = str(row.get("id") or "")
            if not sid or sid == keep_id:
                continue
            if str(row.get("status") or "") not in ACTIVE_STATUSES:
                continue
            try:
                stripe.Subscription.cancel(sid, prorate=False)
            except TypeError:
                stripe.Subscription.cancel(sid)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to cancel superseded Stripe subscription")


def _user_from_refs(
    db: Session,
    *,
    user_id: str | None = None,
    customer_id: str | None = None,
) -> User | None:
    if user_id:
        try:
            user = db.get(User, UUID(user_id))
        except ValueError:
            user = None
        if user is not None:
            return user
    if customer_id:
        return db.scalar(select(User).where(User.stripe_customer_id == customer_id))
    return None


def _checkout_line_item(plan: str, settings: Settings) -> dict[str, Any]:
    price_id = stripe_price_id(plan, settings)
    if price_id:
        return {"price": price_id, "quantity": 1}
    amount = plan_amount_dollars(plan, settings)
    if amount <= 0:
        raise HTTPException(status_code=400, detail={"code": "price_missing", "plan": plan})
    return {
        "price_data": {
            "currency": "usd",
            "unit_amount": amount * 100,
            "recurring": {"interval": "month"},
            "product_data": {
                "name": f"FileWorks {plan.title()}",
                "tax_code": settings.stripe_tax_code,
                "metadata": {"plan": plan},
            },
        },
        "quantity": 1,
    }


def create_checkout_session(
    db: Session,
    user: User,
    plan: str,
    return_to: str | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    if not stripe_billing_enabled(settings):
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    target = (plan or "").strip().lower()
    if not can_change_plan(user.plan, target):
        raise HTTPException(
            status_code=400,
            detail={"code": "plan_invalid", "current": user.plan, "target": target},
        )
    if not purchasable_plans(settings).get(target):
        raise HTTPException(status_code=400, detail={"code": "price_missing", "plan": target})
    stripe = _stripe_mod(settings)
    price_id = stripe_price_id(target, settings)
    if user.stripe_subscription_id and price_id:
        sub = stripe.Subscription.retrieve(user.stripe_subscription_id)
        items = (sub.get("items") or {}).get("data") or []
        if items:
            updated = stripe.Subscription.modify(
                user.stripe_subscription_id,
                items=[{"id": items[0]["id"], "price": price_id}],
                proration_behavior="create_prorations",
                cancel_at_period_end=False,
                metadata={"user_id": str(user.id), "plan": target},
            )
            assigned = apply_subscription(user, dict(updated), settings)
            db.add(user)
            return {"url": None, "updated": True, "plan": assigned}
    dest = _safe_return_path(return_to)
    try:
        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=user.stripe_customer_id or None,
            customer_email=None if user.stripe_customer_id else user.email,
            client_reference_id=str(user.id),
            metadata={"user_id": str(user.id), "plan": target},
            subscription_data={"metadata": {"user_id": str(user.id), "plan": target}},
            line_items=[_checkout_line_item(target, settings)],
            success_url=f"{_app_url(settings)}{dest}?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{_app_url(settings)}{dest}?checkout=cancel",
            allow_promotion_codes=True,
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Stripe checkout failed")
        raise HTTPException(status_code=502, detail=f"Stripe checkout failed: {exc}") from exc
    return {"url": session["url"], "updated": False, "plan": target}


def _portal_configuration_id(stripe) -> str:
    listed = _as_dict(stripe.billing_portal.Configuration.list(limit=20))
    for cfg in listed.get("data") or []:
        obj = _as_dict(cfg)
        if (obj.get("metadata") or {}).get("fileworks") != PORTAL_CONFIG_KEY:
            continue
        config_id = str(obj["id"])
        stripe.billing_portal.Configuration.modify(config_id, features=PORTAL_FEATURES)
        return config_id
    created = _as_dict(
        stripe.billing_portal.Configuration.create(
            business_profile={"headline": "FileWorks billing"},
            features=PORTAL_FEATURES,
            metadata={"fileworks": PORTAL_CONFIG_KEY},
        )
    )
    return str(created["id"])


def create_portal_session(user: User) -> dict[str, str]:
    settings = get_settings()
    if not stripe_billing_enabled(settings):
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    if not user.stripe_customer_id:
        raise HTTPException(status_code=400, detail="No Stripe customer on this account")
    stripe = _stripe_mod(settings)
    session = stripe.billing_portal.Session.create(
        customer=user.stripe_customer_id,
        return_url=f"{_app_url(settings)}/profile?billing=return",
        configuration=_portal_configuration_id(stripe),
    )
    return {"url": session["url"]}


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if hasattr(value, "to_dict"):
        return dict(value.to_dict())
    return dict(value)


def apply_checkout_session(db: Session, obj: dict[str, Any]) -> str | None:
    user_id = str((obj.get("metadata") or {}).get("user_id") or obj.get("client_reference_id") or "")
    customer = obj.get("customer")
    if isinstance(customer, dict):
        customer = customer.get("id")
    user = _user_from_refs(db, user_id=user_id or None, customer_id=str(customer) if customer else None)
    if user is None:
        logger.warning("Stripe checkout completed for unknown user %s", user_id)
        return None
    if customer:
        user.stripe_customer_id = str(customer)
    subscription = obj.get("subscription")
    if isinstance(subscription, dict):
        assigned = apply_subscription(user, subscription, get_settings())
    elif subscription:
        user.stripe_subscription_id = str(subscription)
        assigned = _plan_from_meta(obj) or user.plan
        if assigned in CHANGEABLE_PLANS:
            user.plan = assigned
    else:
        assigned = _plan_from_meta(obj) or user.plan
        if assigned in CHANGEABLE_PLANS:
            user.plan = assigned
    keep_id = user.stripe_subscription_id
    if isinstance(subscription, dict):
        keep_id = str(subscription.get("id") or keep_id or "") or keep_id
    _cancel_other_subscriptions(user, keep_id)
    db.add(user)
    return assigned


def confirm_checkout_session(db: Session, user: User, session_id: str) -> str | None:
    settings = get_settings()
    if not stripe_billing_enabled(settings):
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    stripe = _stripe_mod(settings)
    try:
        session = stripe.checkout.Session.retrieve(session_id, expand=["subscription"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid checkout session: {exc}") from exc
    obj = _as_dict(session)
    ref = str((obj.get("metadata") or {}).get("user_id") or obj.get("client_reference_id") or "")
    if ref and ref != str(user.id):
        raise HTTPException(status_code=403, detail="Checkout session does not belong to this account")
    return apply_checkout_session(db, obj)


def handle_webhook_event(db: Session, event: dict[str, Any]) -> str | None:
    settings = get_settings()
    etype = str(event.get("type") or "")
    obj = (event.get("data") or {}).get("object") or {}
    if etype == "checkout.session.completed":
        return apply_checkout_session(db, obj)
    if etype.startswith("customer.subscription."):
        customer = obj.get("customer")
        if isinstance(customer, dict):
            customer = customer.get("id")
        user_id = str((obj.get("metadata") or {}).get("user_id") or "")
        user = _user_from_refs(db, user_id=user_id or None, customer_id=str(customer) if customer else None)
        if user is None:
            logger.warning("Stripe subscription event for unknown customer %s", customer)
            return None
        incoming_id = str(obj.get("id") or "")
        status = str(obj.get("status") or "")
        current_id = user.stripe_subscription_id
        if (
            current_id
            and incoming_id
            and incoming_id != current_id
            and status not in ACTIVE_STATUSES
        ):
            logger.info("Ignoring Stripe event for superseded subscription %s", incoming_id)
            return None
        assigned = apply_subscription(user, obj, settings)
        db.add(user)
        return assigned
    return None


def construct_webhook_event(payload: bytes, signature: str | None) -> dict[str, Any]:
    settings = get_settings()
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Stripe webhook secret is not configured")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature")
    stripe = _stripe_mod(settings)
    try:
        return stripe.Webhook.construct_event(payload, signature, settings.stripe_webhook_secret)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Invalid Stripe webhook: {exc}") from exc
