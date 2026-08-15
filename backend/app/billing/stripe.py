"""Stripe Checkout / portal / webhooks → FileWorks plan roles."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.plans import CHANGEABLE_PLANS, PLAN_RANK
from app.auth.quota import assert_can_switch_to_plan
from app.core.config import Settings, get_settings
from app.db.models import User

logger = logging.getLogger(__name__)

ACTIVE_STATUSES = frozenset({"active", "trialing", "past_due"})
PENDING_STATUSES = frozenset({"incomplete", "incomplete_expired"})
ENDED_STATUSES = frozenset({"canceled", "unpaid", "incomplete_expired"})
FALLBACK_PLAN = "basic"
DISPLAY_DEFAULTS = {"basic": 0, "pro": 12, "premium": 29}
# Portal: cancel at period end with no refund. Paid grades can switch; no proration.
PORTAL_CONFIG_KEY = "no_refund_cancel"
PAID_PLANS = ("pro", "premium")
PORTAL_FEATURES = {
    "invoice_history": {"enabled": True},
    "payment_method_update": {"enabled": True},
    "subscription_cancel": {
        "enabled": True,
        "mode": "at_period_end",
        "proration_behavior": "none",
    },
    "subscription_update": {
        "enabled": True,
        "default_allowed_updates": ["price"],
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


def _subscription_items(subscription: dict[str, Any]) -> list[dict[str, Any]]:
    items = subscription.get("items")
    if not isinstance(items, dict):
        items = _as_dict(items)
    data = items.get("data") or []
    if not isinstance(data, list):
        return []
    return [item if isinstance(item, dict) else _as_dict(item) for item in data]


def _normalize_subscription(value: Any) -> dict[str, Any]:
    row = _as_dict(value)
    row["items"] = {"data": _subscription_items(row)}
    return row


def _plan_from_meta(payload: dict[str, Any]) -> str | None:
    meta = payload.get("metadata") or {}
    if not isinstance(meta, dict):
        return None
    for key in ("fileworks_plan", "plan"):
        plan = str(meta.get(key) or "").strip().lower()
        if plan in CHANGEABLE_PLANS:
            return plan
    return None


def _plan_from_name(name: str | None) -> str | None:
    text = (name or "").strip().lower()
    if not text:
        return None
    for plan in ("premium", "pro", "basic"):
        if plan in text:
            return plan
    return None


def _plan_from_price_object(price: Any, settings: Settings) -> str | None:
    if isinstance(price, str):
        return plan_for_price(price, settings)
    if not isinstance(price, dict):
        price = _as_dict(price)
        if not price:
            return None
    mapped = plan_for_price(str(price.get("id") or "") or None, settings)
    if mapped:
        return mapped
    from_meta = _plan_from_meta(price)
    if from_meta:
        return from_meta
    product = price.get("product")
    if isinstance(product, dict):
        return _plan_from_meta(product) or _plan_from_name(str(product.get("name") or ""))
    return _plan_from_name(str(price.get("nickname") or ""))


def _plan_from_subscription_item(subscription: dict[str, Any], settings: Settings) -> str | None:
    items = _subscription_items(subscription)
    if not items:
        return None
    return _plan_from_price_object(items[0].get("price"), settings)


def _subscription_plan(subscription: dict[str, Any], settings: Settings | None = None) -> str:
    settings = settings or get_settings()
    return (
        _plan_from_subscription_item(subscription, settings)
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
        items = _subscription_items(subscription)
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
    listed = _as_dict(
        stripe.Subscription.list(
            customer=customer_id,
            status="all",
            limit=10,
            expand=["data.items.data.price.product"],
        )
    )
    data = listed.get("data") or []
    if not isinstance(data, list):
        return []
    return [_normalize_subscription(item) for item in data]


def _load_subscription(stripe, user: User, settings: Settings) -> dict[str, Any] | None:
    """Return the subscription to apply.

    Raises RuntimeError when Stripe cannot be reached, so callers do not demote a paid role.
    """
    retrieved: dict[str, Any] | None = None
    if user.stripe_subscription_id:
        try:
            retrieved = _normalize_subscription(
                stripe.Subscription.retrieve(
                    user.stripe_subscription_id,
                    expand=["items.data.price.product"],
                )
            )
        except Exception as exc:  # noqa: BLE001
            logger.info("Stripe subscription %s lookup failed: %s", user.stripe_subscription_id, exc)
            retrieved = None

    listed: list[dict[str, Any]] | None = None
    if user.stripe_customer_id:
        try:
            listed = _list_customer_subscriptions(stripe, user.stripe_customer_id)
        except Exception as exc:  # noqa: BLE001
            if retrieved is None:
                raise RuntimeError("Stripe subscription list failed") from exc
            listed = None

    pool: list[dict[str, Any]] = []
    if listed:
        pool.extend(listed)
    if retrieved and not any(row.get("id") == retrieved.get("id") for row in pool):
        pool.append(retrieved)
    active = [row for row in pool if str(row.get("status") or "") in ACTIVE_STATUSES]
    if active:
        return _prefer_subscription(active, settings)
    if retrieved is not None:
        return retrieved
    if listed is not None:
        return listed[0] if listed else None
    raise RuntimeError("Stripe subscription lookup failed")


def _find_customer_by_email(stripe, email: str) -> str | None:
    if not email:
        return None
    listed = _as_dict(stripe.Customer.list(email=email, limit=10))
    data = listed.get("data") or []
    if not isinstance(data, list):
        return None
    rows = [_as_dict(item) for item in data]
    ids = [str(row.get("id") or "") for row in rows if row.get("id")]
    if not ids:
        return None
    if len(ids) == 1:
        return ids[0]
    for customer_id in ids:
        try:
            subs = _list_customer_subscriptions(stripe, customer_id)
        except Exception:  # noqa: BLE001
            continue
        if any(str(row.get("status") or "") in ACTIVE_STATUSES for row in subs):
            return customer_id
    return ids[0]


def _ensure_stripe_customer(
    db: Session,
    user: User,
    stripe,
    *,
    create: bool,
) -> str | None:
    if user.stripe_customer_id:
        return user.stripe_customer_id
    customer_id = _find_customer_by_email(stripe, user.email)
    if not customer_id and create:
        created = _as_dict(
            stripe.Customer.create(
                email=user.email,
                name=user.name or None,
                metadata={"user_id": str(user.id)},
            )
        )
        customer_id = str(created.get("id") or "") or None
    if not customer_id:
        return None
    user.stripe_customer_id = customer_id
    db.add(user)
    return customer_id


def sync_user_subscription(db: Session, user: User) -> dict[str, Any]:
    """Pull the Stripe subscription into user.plan so the UI does not wait on webhooks."""
    settings = get_settings()
    if not stripe_billing_enabled(settings):
        return {}
    try:
        stripe = _stripe_mod(settings)
        if not user.stripe_customer_id and not user.stripe_subscription_id:
            if not _ensure_stripe_customer(db, user, stripe, create=False):
                return {}
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


def _find_or_create_plan_price(stripe, plan: str, amount: int, settings: Settings) -> tuple[str, str]:
    """Stable Stripe product/price for a dollar-amount plan so the portal can switch."""
    listed = _as_dict(stripe.Product.list(active=True, limit=100))
    unit = amount * 100
    for raw in listed.get("data") or []:
        product = _as_dict(raw)
        if (product.get("metadata") or {}).get("fileworks_plan") != plan:
            continue
        product_id = str(product["id"])
        prices = _as_dict(stripe.Price.list(product=product_id, active=True, limit=20))
        for price_raw in prices.get("data") or []:
            price = _as_dict(price_raw)
            recurring = price.get("recurring") or {}
            if price.get("unit_amount") == unit and recurring.get("interval") == "month":
                return product_id, str(price["id"])
        created_price = _as_dict(
            stripe.Price.create(
                product=product_id,
                currency="usd",
                unit_amount=unit,
                recurring={"interval": "month"},
                metadata={"fileworks_plan": plan},
            )
        )
        return product_id, str(created_price["id"])
    product = _as_dict(
        stripe.Product.create(
            name=f"FileWorks {plan.title()}",
            metadata={"fileworks_plan": plan},
            tax_code=settings.stripe_tax_code,
        )
    )
    price = _as_dict(
        stripe.Price.create(
            product=product["id"],
            currency="usd",
            unit_amount=unit,
            recurring={"interval": "month"},
            metadata={"fileworks_plan": plan},
        )
    )
    return str(product["id"]), str(price["id"])


def _portal_products(stripe, settings: Settings) -> list[dict[str, Any]]:
    products: list[dict[str, Any]] = []
    purchasable = purchasable_plans(settings)
    for plan in PAID_PLANS:
        if not purchasable.get(plan):
            continue
        price_id = stripe_price_id(plan, settings)
        if price_id:
            price = _as_dict(stripe.Price.retrieve(price_id))
            product = price.get("product")
            if isinstance(product, dict):
                product = product.get("id")
            if product:
                products.append({"product": str(product), "prices": [price_id]})
            continue
        amount = plan_amount_dollars(plan, settings)
        if amount <= 0:
            continue
        product_id, created_price = _find_or_create_plan_price(stripe, plan, amount, settings)
        products.append({"product": product_id, "prices": [created_price]})
    return products


def _portal_features(stripe, settings: Settings) -> dict[str, Any]:
    features = {
        "invoice_history": dict(PORTAL_FEATURES["invoice_history"]),
        "payment_method_update": dict(PORTAL_FEATURES["payment_method_update"]),
        "subscription_cancel": dict(PORTAL_FEATURES["subscription_cancel"]),
        "subscription_update": {
            "enabled": False,
            "default_allowed_updates": [],
            "proration_behavior": "none",
        },
    }
    try:
        products = _portal_products(stripe, settings)
    except Exception:  # noqa: BLE001
        logger.exception("Failed to resolve Stripe portal products")
        products = []
    if products:
        features["subscription_update"] = {
            "enabled": True,
            "default_allowed_updates": ["price"],
            "proration_behavior": "none",
            "products": products,
        }
    return features


def _subscription_price_id_for_plan(stripe, plan: str, settings: Settings) -> str | None:
    price_id = stripe_price_id(plan, settings)
    if price_id:
        return price_id
    amount = plan_amount_dollars(plan, settings)
    if amount <= 0:
        return None
    try:
        return _find_or_create_plan_price(stripe, plan, amount, settings)[1]
    except Exception:  # noqa: BLE001
        logger.exception("Failed to resolve Stripe price for %s", plan)
        return None


def _active_subscription(stripe, user: User) -> dict[str, Any] | None:
    retrieved: dict[str, Any] | None = None
    if user.stripe_subscription_id:
        try:
            sub = _normalize_subscription(
                stripe.Subscription.retrieve(
                    user.stripe_subscription_id,
                    expand=["items.data.price.product"],
                )
            )
            if str(sub.get("status") or "") in ACTIVE_STATUSES:
                retrieved = sub
        except Exception:  # noqa: BLE001
            logger.info("Stored Stripe subscription %s is not usable", user.stripe_subscription_id)
    listed_active: list[dict[str, Any]] = []
    if user.stripe_customer_id:
        try:
            listed_active = [
                row
                for row in _list_customer_subscriptions(stripe, user.stripe_customer_id)
                if str(row.get("status") or "") in ACTIVE_STATUSES
            ]
        except Exception:  # noqa: BLE001
            listed_active = []
    if listed_active:
        preferred = _prefer_subscription(listed_active, get_settings())
        if _subscription_item_id(preferred) or not retrieved:
            return preferred
    return retrieved


def _subscription_item_id(subscription: dict[str, Any]) -> str | None:
    items = _subscription_items(subscription)
    if not items:
        return None
    sid = str(items[0].get("id") or "")
    return sid or None


def _plan_change_confirm_url(
    stripe,
    settings: Settings,
    *,
    customer_id: str,
    subscription: dict[str, Any],
    price_id: str,
    dest: str,
) -> str | None:
    item_id = _subscription_item_id(subscription)
    sub_id = str(subscription.get("id") or "")
    if not item_id or not sub_id:
        return None
    return_url = f"{_app_url(settings)}{dest}?billing=return"
    session = _as_dict(
        stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=return_url,
            configuration=_portal_configuration_id(stripe, settings),
            flow_data={
                "type": "subscription_update_confirm",
                "subscription_update_confirm": {
                    "subscription": sub_id,
                    "items": [{"id": item_id, "price": price_id, "quantity": 1}],
                },
            },
        )
    )
    return str(session.get("url") or "") or None


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
    assert_can_switch_to_plan(db, user_id=user.id, current=user.plan, target=target)
    if not purchasable_plans(settings).get(target):
        raise HTTPException(status_code=400, detail={"code": "price_missing", "plan": target})
    dest = _safe_return_path(return_to)
    try:
        stripe = _stripe_mod(settings)
        customer_id = _ensure_stripe_customer(db, user, stripe, create=True)
        if not customer_id:
            raise HTTPException(status_code=502, detail="Could not create a Stripe customer")
        price_id = _subscription_price_id_for_plan(stripe, target, settings)
        current = _active_subscription(stripe, user)
        if current:
            if not price_id:
                raise HTTPException(status_code=502, detail="Could not resolve a Stripe price for this plan")
            try:
                confirm_url = _plan_change_confirm_url(
                    stripe,
                    settings,
                    customer_id=customer_id,
                    subscription=current,
                    price_id=price_id,
                    dest=dest,
                )
            except HTTPException:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.exception("Stripe plan-confirm portal failed")
                raise HTTPException(
                    status_code=502,
                    detail=f"Stripe could not confirm the plan change: {exc}",
                ) from exc
            if not confirm_url:
                raise HTTPException(
                    status_code=502,
                    detail="Stripe could not open a plan-change confirmation",
                )
            return {"url": confirm_url, "updated": False, "plan": target}
        session = _as_dict(
            stripe.checkout.Session.create(
                mode="subscription",
                customer=customer_id,
                client_reference_id=str(user.id),
                metadata={"user_id": str(user.id), "plan": target},
                subscription_data={"metadata": {"user_id": str(user.id), "plan": target}},
                line_items=(
                    [{"price": price_id, "quantity": 1}]
                    if price_id
                    else [_checkout_line_item(target, settings)]
                ),
                success_url=f"{_app_url(settings)}{dest}?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{_app_url(settings)}{dest}?checkout=cancel",
                allow_promotion_codes=True,
            )
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Stripe checkout failed")
        raise HTTPException(status_code=502, detail=f"Stripe checkout failed: {exc}") from exc
    url = str(session.get("url") or "")
    if not url:
        raise HTTPException(status_code=502, detail="Stripe did not return a billing URL")
    return {"url": url, "updated": False, "plan": target}


def _portal_configuration_id(stripe, settings: Settings) -> str:
    features = _portal_features(stripe, settings)
    listed = _as_dict(stripe.billing_portal.Configuration.list(limit=20))
    for cfg in listed.get("data") or []:
        obj = _as_dict(cfg)
        if (obj.get("metadata") or {}).get("fileworks") != PORTAL_CONFIG_KEY:
            continue
        config_id = str(obj["id"])
        stripe.billing_portal.Configuration.modify(config_id, features=features)
        return config_id
    created = _as_dict(
        stripe.billing_portal.Configuration.create(
            business_profile={"headline": "FileWorks billing"},
            features=features,
            metadata={"fileworks": PORTAL_CONFIG_KEY},
        )
    )
    return str(created["id"])


def create_portal_session(db: Session, user: User) -> dict[str, str]:
    settings = get_settings()
    if not stripe_billing_enabled(settings):
        raise HTTPException(status_code=503, detail="Stripe is not configured")
    try:
        stripe = _stripe_mod(settings)
        customer_id = _ensure_stripe_customer(db, user, stripe, create=False)
        if not customer_id:
            raise HTTPException(
                status_code=400,
                detail="No Stripe billing on this account. Subscribe from Pricing first.",
            )
        session = _as_dict(
            stripe.billing_portal.Session.create(
                customer=customer_id,
                return_url=f"{_app_url(settings)}/profile?billing=return",
                configuration=_portal_configuration_id(stripe, settings),
            )
        )
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.exception("Stripe portal failed")
        raise HTTPException(status_code=502, detail=f"Stripe portal failed: {exc}") from exc
    url = str(session.get("url") or "")
    if not url:
        raise HTTPException(status_code=502, detail="Stripe did not return a billing URL")
    return {"url": url}


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    to_dict = getattr(value, "to_dict", None)
    if callable(to_dict):
        converted = to_dict()
        if isinstance(converted, dict):
            return dict(converted)
    try:
        return dict(value)
    except Exception:  # noqa: BLE001
        return {}


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
    obj = _as_dict((event.get("data") or {}).get("object") or {})
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
