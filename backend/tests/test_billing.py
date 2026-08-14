from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, patch
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.auth_routes import router as auth_router
from app.api.billing_routes import router as billing_router
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.billing.stripe import (
    apply_subscription,
    billing_status,
    handle_webhook_event,
    plan_for_price,
    stripe_billing_enabled,
    sync_user_subscription,
)
from app.core.config import Settings
from app.db.models import User
from app.db.session import get_db


def _settings(**overrides: object) -> Settings:
    values = {
        "_env_file": None,
        "jwt_secret": "test-secret-do-not-use-in-prod-please",
        "stripe_secret_key": "sk_test_x",
        "stripe_webhook_secret": "whsec_x",
        "stripe_price_basic": "price_basic",
        "stripe_price_pro": "price_pro",
        "stripe_price_premium": "price_premium",
        "public_app_url": "http://localhost:3000",
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


def _user(plan: str = "basic") -> User:
    user = User(email="a@b.co", google_sub="g1", name="A", plan=plan)
    user.id = uuid4()
    return user


class StripeMappingTests(unittest.TestCase):
    def test_price_maps_to_role(self) -> None:
        settings = _settings()
        self.assertTrue(stripe_billing_enabled(settings))
        self.assertEqual(plan_for_price("price_pro", settings), "pro")
        self.assertEqual(plan_for_price("price_premium", settings), "premium")
        self.assertEqual(plan_for_price("price_basic", settings), "basic")
        self.assertIsNone(plan_for_price("price_other", settings))
        self.assertFalse(stripe_billing_enabled(_settings(stripe_secret_key=None, stripe_price_pro=None)))

    def test_billing_status_flags(self) -> None:
        status = billing_status(_settings(stripe_price_basic=None))
        self.assertTrue(status["enabled"])
        self.assertFalse(status["prices"]["basic"])
        self.assertTrue(status["prices"]["pro"])
        self.assertEqual(status["amounts"]["pro"], 12)
        self.assertEqual(status["amounts"]["premium"], 29)

    def test_numeric_amounts_are_display_dollars(self) -> None:
        settings = _settings(stripe_price_basic="0", stripe_price_pro="20", stripe_price_premium="50")
        status = billing_status(settings)
        self.assertTrue(status["enabled"])
        self.assertEqual(status["amounts"], {"basic": 0, "pro": 20, "premium": 50})
        self.assertFalse(status["prices"]["basic"])
        self.assertTrue(status["prices"]["pro"])
        self.assertTrue(status["prices"]["premium"])
        self.assertIsNone(plan_for_price("20", settings))

    def test_apply_subscription_assigns_role(self) -> None:
        user = _user()
        settings = _settings()
        plan = apply_subscription(
            user,
            {
                "id": "sub_1",
                "status": "active",
                "customer": "cus_1",
                "items": {"data": [{"price": {"id": "price_premium"}}]},
            },
            settings,
        )
        self.assertEqual(plan, "premium")
        self.assertEqual(user.plan, "premium")
        self.assertEqual(user.stripe_customer_id, "cus_1")
        self.assertEqual(user.stripe_subscription_id, "sub_1")

    def test_apply_subscription_uses_metadata_when_price_is_ad_hoc(self) -> None:
        user = _user()
        plan = apply_subscription(
            user,
            {
                "id": "sub_2",
                "status": "active",
                "customer": "cus_2",
                "metadata": {"plan": "pro"},
                "items": {"data": [{"price": {"id": "price_adhoc"}}]},
            },
            _settings(stripe_price_pro="20"),
        )
        self.assertEqual(plan, "pro")
        self.assertEqual(user.plan, "pro")

    def test_canceled_subscription_falls_back_to_basic(self) -> None:
        user = _user("pro")
        user.stripe_subscription_id = "sub_1"
        apply_subscription(user, {"id": "sub_1", "status": "canceled", "customer": "cus_1"}, _settings())
        self.assertEqual(user.plan, "basic")
        self.assertIsNone(user.stripe_subscription_id)

    def test_cancel_at_period_end_keeps_paid_plan(self) -> None:
        user = _user("pro")
        user.stripe_subscription_id = "sub_1"
        apply_subscription(
            user,
            {
                "id": "sub_1",
                "status": "active",
                "cancel_at_period_end": True,
                "customer": "cus_1",
                "metadata": {"plan": "pro"},
                "items": {"data": [{"price": {"id": "price_adhoc"}}]},
            },
            _settings(stripe_price_pro="20"),
        )
        self.assertEqual(user.plan, "pro")
        self.assertEqual(user.stripe_subscription_id, "sub_1")

    def test_incomplete_subscription_does_not_demote(self) -> None:
        user = _user("pro")
        user.stripe_subscription_id = "sub_old"
        apply_subscription(
            user,
            {"id": "sub_new", "status": "incomplete", "customer": "cus_1", "metadata": {"plan": "premium"}},
            _settings(),
        )
        self.assertEqual(user.plan, "pro")
        self.assertEqual(user.stripe_subscription_id, "sub_old")

    def test_sync_canceled_subscription_sets_basic(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        user.stripe_subscription_id = "sub_1"
        stripe = MagicMock()
        stripe.Subscription.retrieve.return_value = {
            "id": "sub_1",
            "status": "canceled",
            "customer": "cus_1",
        }
        stripe.Subscription.list.return_value = {"data": []}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            view = sync_user_subscription(MagicMock(), user)
        self.assertEqual(user.plan, "basic")
        self.assertIsNone(user.stripe_subscription_id)
        self.assertFalse(view["cancel_at_period_end"])

    def test_sync_cancel_at_period_end_keeps_paid_plan(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        user.stripe_subscription_id = "sub_1"
        stripe = MagicMock()
        stripe.Subscription.retrieve.return_value = {
            "id": "sub_1",
            "status": "active",
            "cancel_at_period_end": True,
            "current_period_end": 1893456000,
            "customer": "cus_1",
            "metadata": {"plan": "pro"},
            "items": {"data": [{"price": {"id": "price_adhoc"}}]},
        }
        with patch("app.billing.stripe.get_settings", return_value=_settings(stripe_price_pro="20")), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            view = sync_user_subscription(MagicMock(), user)
        self.assertEqual(user.plan, "pro")
        self.assertTrue(view["cancel_at_period_end"])
        self.assertEqual(view["subscription_status"], "active")
        self.assertTrue(view["current_period_end"])

    def test_sync_stripe_outage_does_not_demote(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        user.stripe_subscription_id = "sub_1"
        stripe = MagicMock()
        stripe.Subscription.retrieve.side_effect = RuntimeError("stripe down")
        stripe.Subscription.list.side_effect = RuntimeError("stripe down")
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            view = sync_user_subscription(MagicMock(), user)
        self.assertEqual(user.plan, "pro")
        self.assertEqual(user.stripe_subscription_id, "sub_1")
        self.assertEqual(view, {})

    def test_sync_prefers_active_subscription_if_stored_one_ended(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        user.stripe_subscription_id = "sub_old"
        stripe = MagicMock()
        stripe.Subscription.retrieve.return_value = {"id": "sub_old", "status": "canceled", "customer": "cus_1"}
        stripe.Subscription.list.return_value = {
            "data": [
                {"id": "sub_old", "status": "canceled", "customer": "cus_1"},
                {
                    "id": "sub_new",
                    "status": "active",
                    "customer": "cus_1",
                    "metadata": {"plan": "premium"},
                    "items": {"data": [{"price": {"id": "price_adhoc"}}]},
                },
            ]
        }
        with patch("app.billing.stripe.get_settings", return_value=_settings(stripe_price_premium="50")), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            view = sync_user_subscription(MagicMock(), user)
        self.assertEqual(user.plan, "premium")
        self.assertEqual(user.stripe_subscription_id, "sub_new")
        self.assertEqual(view["subscription_status"], "active")

    def test_period_end_reads_subscription_item(self) -> None:
        from app.billing.stripe import subscription_view

        view = subscription_view(
            {
                "status": "active",
                "cancel_at_period_end": True,
                "items": {"data": [{"current_period_end": 1893456000}]},
            }
        )
        self.assertTrue(view["current_period_end"])


class WebhookApplyTests(unittest.TestCase):
    def test_checkout_completed_sets_plan(self) -> None:
        user = _user()
        db = MagicMock()
        db.get.return_value = user
        stripe = MagicMock()
        stripe.Subscription.list.return_value = {"data": []}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            assigned = handle_webhook_event(
            db,
            {
                "type": "checkout.session.completed",
                "data": {
                    "object": {
                        "client_reference_id": str(user.id),
                        "customer": "cus_9",
                        "subscription": "sub_9",
                        "metadata": {"user_id": str(user.id), "plan": "pro"},
                    }
                },
            },
            )
        self.assertEqual(assigned, "pro")
        self.assertEqual(user.plan, "pro")
        self.assertEqual(user.stripe_customer_id, "cus_9")
        self.assertEqual(user.stripe_subscription_id, "sub_9")

    def test_subscription_updated_maps_price(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_2"
        db = MagicMock()
        db.scalar.return_value = user
        with patch("app.billing.stripe.get_settings", return_value=_settings()):
            assigned = handle_webhook_event(
                db,
                {
                    "type": "customer.subscription.updated",
                    "data": {
                        "object": {
                            "id": "sub_2",
                            "status": "active",
                            "customer": "cus_2",
                            "items": {"data": [{"price": {"id": "price_premium"}}]},
                        }
                    },
                },
            )
        self.assertEqual(assigned, "premium")
        self.assertEqual(user.plan, "premium")

    def test_subscription_deleted_ignores_superseded_id(self) -> None:
        user = _user("premium")
        user.stripe_customer_id = "cus_2"
        user.stripe_subscription_id = "sub_new"
        db = MagicMock()
        db.scalar.return_value = user
        with patch("app.billing.stripe.get_settings", return_value=_settings()):
            assigned = handle_webhook_event(
                db,
                {
                    "type": "customer.subscription.deleted",
                    "data": {
                        "object": {
                            "id": "sub_old",
                            "status": "canceled",
                            "customer": "cus_2",
                        }
                    },
                },
            )
        self.assertIsNone(assigned)
        self.assertEqual(user.plan, "premium")
        self.assertEqual(user.stripe_subscription_id, "sub_new")


class BillingRouteTests(unittest.TestCase):
    def _app(self, user: User, db: object | None = None) -> FastAPI:
        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.include_router(billing_router, prefix="/api")
        store = db if db is not None else SimpleNamespace(get=lambda *_a, **_k: user, add=lambda *_a, **_k: None)
        app.dependency_overrides[get_db] = lambda: store
        app.dependency_overrides[get_principal] = lambda: Principal(plan=get_plan(user.plan), user=user)
        return app

    def test_checkout_creates_session(self) -> None:
        user = _user()
        session = {"url": "https://checkout.stripe.test/cs_1"}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod"
        ) as stripe_mod:
            stripe_mod.return_value.checkout.Session.create.return_value = session
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["url"], "https://checkout.stripe.test/cs_1")
        self.assertFalse(res.json()["updated"])

    def test_checkout_uses_price_data_for_dollar_amounts(self) -> None:
        user = _user()
        stripe = MagicMock()
        stripe.checkout.Session.create.return_value = {"url": "https://checkout.stripe.test/cs_amt"}
        with patch(
            "app.billing.stripe.get_settings",
            return_value=_settings(stripe_price_basic="0", stripe_price_pro="20", stripe_price_premium="50"),
        ), patch("app.billing.stripe._stripe_mod", return_value=stripe):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro", "return_to": "/pricing"})
        self.assertEqual(res.status_code, 200)
        kwargs = stripe.checkout.Session.create.call_args.kwargs
        self.assertEqual(kwargs["line_items"][0]["price_data"]["unit_amount"], 2000)
        self.assertEqual(
            kwargs["line_items"][0]["price_data"]["product_data"]["tax_code"],
            "txcd_10103000",
        )
        self.assertIn("/pricing?checkout=success", kwargs["success_url"])

    def test_catalog_is_public(self) -> None:
        with patch(
            "app.billing.stripe.get_settings",
            return_value=_settings(stripe_price_basic="0", stripe_price_pro="20", stripe_price_premium="50"),
        ):
            app = FastAPI()
            app.include_router(billing_router, prefix="/api")
            client = TestClient(app)
            res = client.get("/api/billing/catalog")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["amounts"]["pro"], 20)
        self.assertTrue(res.json()["prices"]["pro"])

    def test_confirm_applies_checkout_session(self) -> None:
        user = _user()
        stripe = MagicMock()
        stripe.checkout.Session.retrieve.return_value = {
            "client_reference_id": str(user.id),
            "customer": "cus_9",
            "subscription": "sub_9",
            "metadata": {"user_id": str(user.id), "plan": "pro"},
        }
        stripe.Subscription.list.return_value = {"data": []}
        db = SimpleNamespace(get=lambda *_a, **_k: user, add=lambda *_a, **_k: None)
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user, db))
            res = client.post("/api/billing/confirm", json={"session_id": "cs_1"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["plan"], "pro")
        self.assertEqual(user.plan, "pro")

    def test_confirm_cancels_prior_subscription(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_9"
        user.stripe_subscription_id = "sub_old"
        stripe = MagicMock()
        stripe.checkout.Session.retrieve.return_value = {
            "client_reference_id": str(user.id),
            "customer": "cus_9",
            "subscription": "sub_new",
            "metadata": {"user_id": str(user.id), "plan": "premium"},
        }
        stripe.Subscription.list.return_value = {
            "data": [
                {"id": "sub_old", "status": "active", "customer": "cus_9"},
                {"id": "sub_new", "status": "active", "customer": "cus_9"},
            ]
        }
        db = SimpleNamespace(get=lambda *_a, **_k: user, add=lambda *_a, **_k: None)
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user, db))
            res = client.post("/api/billing/confirm", json={"session_id": "cs_1"})
        self.assertEqual(res.status_code, 200)
        stripe.Subscription.cancel.assert_called_once_with("sub_old", prorate=False)

    def test_existing_subscription_updates_price(self) -> None:
        user = _user("pro")
        user.stripe_subscription_id = "sub_1"
        user.stripe_customer_id = "cus_1"
        stripe = MagicMock()
        stripe.Subscription.retrieve.return_value = {"items": {"data": [{"id": "si_1"}]}}
        stripe.Subscription.modify.return_value = {
            "id": "sub_1",
            "status": "active",
            "customer": "cus_1",
            "items": {"data": [{"price": {"id": "price_premium"}}]},
        }
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "premium"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["updated"])
        self.assertEqual(user.plan, "premium")
        self.assertFalse(stripe.Subscription.modify.call_args.kwargs["cancel_at_period_end"])

    def test_portal_requires_customer(self) -> None:
        user = _user()
        with patch("app.billing.stripe.get_settings", return_value=_settings()):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/portal")
        self.assertEqual(res.status_code, 400)

    def test_portal_returns_url(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        stripe = MagicMock()
        stripe.billing_portal.Configuration.list.return_value = {
            "data": [{"id": "bpc_1", "metadata": {"fileworks": "no_refund_cancel"}}]
        }
        stripe.billing_portal.Session.create.return_value = {"url": "https://billing.stripe.test/p"}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/portal")
        self.assertEqual(res.status_code, 200)
        self.assertIn("billing.stripe.test", res.json()["url"])
        stripe.billing_portal.Session.create.assert_called_once()
        self.assertEqual(stripe.billing_portal.Session.create.call_args.kwargs["configuration"], "bpc_1")
        stripe.billing_portal.Configuration.create.assert_not_called()
        stripe.billing_portal.Configuration.modify.assert_called_once_with("bpc_1", features=ANY)

    def test_portal_creates_no_refund_cancel_config(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        stripe = MagicMock()
        stripe.billing_portal.Configuration.list.return_value = {"data": []}
        stripe.billing_portal.Configuration.create.return_value = {"id": "bpc_new"}
        stripe.billing_portal.Session.create.return_value = {"url": "https://billing.stripe.test/p"}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/portal")
        self.assertEqual(res.status_code, 200)
        created = stripe.billing_portal.Configuration.create.call_args.kwargs
        cancel = created["features"]["subscription_cancel"]
        self.assertEqual(cancel["mode"], "at_period_end")
        self.assertEqual(cancel["proration_behavior"], "none")
        self.assertFalse(created["features"]["subscription_update"]["enabled"])
        self.assertEqual(stripe.billing_portal.Session.create.call_args.kwargs["configuration"], "bpc_new")

    def test_webhook_rejects_bad_signature(self) -> None:
        with patch("app.api.billing_routes.construct_webhook_event", side_effect=HTTPException(status_code=400, detail="bad")):
            app = FastAPI()
            app.include_router(billing_router, prefix="/api")
            app.dependency_overrides[get_db] = lambda: MagicMock()
            client = TestClient(app)
            res = client.post("/api/billing/webhook", content=b"{}", headers={"stripe-signature": "nope"})
        self.assertEqual(res.status_code, 400)

    def test_instant_plan_change_blocked_when_stripe_on(self) -> None:
        user = _user()
        with patch("app.api.auth_routes.stripe_billing_enabled", return_value=True):
            client = TestClient(self._app(user))
            res = client.post("/api/me/plan", json={"plan": "pro"})
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["detail"]["code"], "billing_required")


if __name__ == "__main__":
    unittest.main()
