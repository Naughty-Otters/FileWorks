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
    _as_dict,
    _plan_from_name,
    _product_display_name,
    apply_checkout_session,
    apply_subscription,
    billing_status,
    construct_webhook_event,
    handle_webhook_event,
    normalize_billing_interval,
    parse_amount_dollars,
    plan_amount_dollars,
    plan_for_price,
    stripe_billing_enabled,
    subscription_view,
    sync_user_subscription,
    yearly_amount_from_monthly,
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


def _portal_stripe() -> MagicMock:
    stripe = MagicMock()
    stripe.Customer.retrieve.side_effect = lambda cid, **_: {"id": cid}
    stripe.Subscription.retrieve.return_value = {
        "id": "sub_1",
        "status": "active",
        "items": {"data": [{"id": "si_1"}]},
    }
    stripe.Subscription.list.return_value = {"data": []}
    stripe.Price.retrieve.side_effect = lambda pid, **_: {"id": pid, "product": f"prod_{pid}"}
    stripe.billing_portal.Configuration.list.return_value = {
        "data": [{"id": "bpc_1", "metadata": {"fileworks": "no_refund_cancel"}}]
    }
    stripe.billing_portal.Session.create.return_value = {"url": "https://billing.stripe.test/confirm"}
    return stripe


class StripeMappingTests(unittest.TestCase):
    def test_yearly_math_helpers(self) -> None:
        self.assertEqual(yearly_amount_from_monthly(5), 42)
        self.assertEqual(yearly_amount_from_monthly(29), 244)
        self.assertEqual(normalize_billing_interval("year"), "year")
        self.assertEqual(normalize_billing_interval("YEAR"), "year")
        self.assertEqual(normalize_billing_interval("weekly"), "month")
        self.assertEqual(normalize_billing_interval(None), "month")

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
        self.assertEqual(status["amounts"]["pro"], 5)
        self.assertEqual(status["amounts"]["premium"], 29)
        self.assertEqual(status["yearly_discount"], 0.3)
        self.assertEqual(status["yearly_amounts"]["pro"], 42)
        self.assertEqual(status["yearly_amounts"]["premium"], 244)

    def test_yearly_amount_env_override(self) -> None:
        settings = _settings(stripe_price_pro="5", stripe_price_pro_yearly="40")
        self.assertEqual(plan_amount_dollars("pro", settings, "month"), 5)
        self.assertEqual(plan_amount_dollars("pro", settings, "year"), 40)
        self.assertEqual(plan_for_price("price_pro_yearly", _settings(stripe_price_pro_yearly="price_pro_yearly")), "pro")

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

    def test_apply_subscription_prefers_price_metadata_over_stale_plan(self) -> None:
        user = _user("pro")
        plan = apply_subscription(
            user,
            {
                "id": "sub_2",
                "status": "active",
                "customer": "cus_2",
                "metadata": {"plan": "pro"},
                "items": {
                    "data": [
                        {
                            "price": {
                                "id": "price_adhoc",
                                "metadata": {"fileworks_plan": "premium"},
                                "product": {"name": "FileWorks Premium", "metadata": {"fileworks_plan": "premium"}},
                            }
                        }
                    ]
                },
            },
            _settings(stripe_price_pro="20", stripe_price_premium="50"),
        )
        self.assertEqual(plan, "premium")
        self.assertEqual(user.plan, "premium")

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
            stripe = stripe_mod.return_value
            stripe.Customer.list.return_value = {"data": []}
            stripe.Customer.create.return_value = {"id": "cus_new"}
            stripe.checkout.Session.create.return_value = session
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["url"], "https://checkout.stripe.test/cs_1")
        self.assertFalse(res.json()["updated"])
        self.assertEqual(user.stripe_customer_id, "cus_new")
        self.assertEqual(stripe.checkout.Session.create.call_args.kwargs["customer"], "cus_new")
        self.assertEqual(
            stripe.checkout.Session.create.call_args.kwargs["metadata"]["fileworks_interval"],
            "month",
        )

    def test_checkout_yearly_interval(self) -> None:
        user = _user()
        with patch(
            "app.billing.stripe.get_settings",
            return_value=_settings(stripe_price_pro="5", stripe_price_pro_yearly=None),
        ), patch("app.billing.stripe._stripe_mod") as stripe_mod:
            stripe = stripe_mod.return_value
            stripe.Customer.list.return_value = {"data": []}
            stripe.Customer.create.return_value = {"id": "cus_new"}
            stripe.Product.list.return_value = {"data": []}
            stripe.Product.create.return_value = {"id": "prod_pro"}
            stripe.Price.create.return_value = {"id": "price_pro_year"}
            stripe.checkout.Session.create.return_value = {"url": "https://checkout.stripe.test/year"}
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro", "interval": "year"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["url"], "https://checkout.stripe.test/year")
        create_kwargs = stripe.checkout.Session.create.call_args.kwargs
        self.assertEqual(create_kwargs["metadata"]["fileworks_interval"], "year")
        self.assertEqual(create_kwargs["line_items"], [{"price": "price_pro_year", "quantity": 1}])
        price_kwargs = stripe.Price.create.call_args.kwargs
        self.assertEqual(price_kwargs["unit_amount"], 4200)
        self.assertEqual(price_kwargs["recurring"]["interval"], "year")

    def test_checkout_recovers_from_stale_customer_id(self) -> None:
        user = _user()
        user.stripe_customer_id = "cus_stale"

        class MissingCustomerError(Exception):
            pass

        stripe = MagicMock()
        stripe.Customer.retrieve.side_effect = MissingCustomerError("No such customer: 'cus_stale'")
        stripe.Customer.list.return_value = {"data": []}
        stripe.Customer.create.return_value = {"id": "cus_new"}
        stripe.checkout.Session.create.return_value = {"url": "https://checkout.stripe.test/cs_1"}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(user.stripe_customer_id, "cus_new")
        self.assertEqual(stripe.checkout.Session.create.call_args.kwargs["customer"], "cus_new")

    def test_checkout_treats_deleted_customer_as_missing(self) -> None:
        user = _user()
        user.stripe_customer_id = "cus_deleted"
        stripe = MagicMock()
        stripe.Customer.retrieve.return_value = {"id": "cus_deleted", "deleted": True}
        stripe.Customer.list.return_value = {"data": []}
        stripe.Customer.create.return_value = {"id": "cus_new"}
        stripe.checkout.Session.create.return_value = {"url": "https://checkout.stripe.test/cs_1"}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(user.stripe_customer_id, "cus_new")
        self.assertEqual(stripe.checkout.Session.create.call_args.kwargs["customer"], "cus_new")

    def test_checkout_retries_when_session_create_rejects_customer(self) -> None:
        user = _user()
        user.stripe_customer_id = "cus_stale"
        stripe = MagicMock()
        stripe.Customer.retrieve.return_value = {"id": "cus_stale"}
        stripe.Customer.create.return_value = {"id": "cus_new"}
        stripe.checkout.Session.create.side_effect = [
            RuntimeError("No such customer: 'cus_stale'"),
            {"url": "https://checkout.stripe.test/cs_1"},
        ]
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(user.stripe_customer_id, "cus_new")
        self.assertEqual(stripe.checkout.Session.create.call_count, 2)
        self.assertEqual(stripe.checkout.Session.create.call_args.kwargs["customer"], "cus_new")

    def test_checkout_skips_stale_email_customer_match(self) -> None:
        user = _user()
        stripe = MagicMock()

        class MissingCustomerError(Exception):
            pass

        def retrieve(customer_id: str):
            if customer_id == "cus_stale":
                raise MissingCustomerError("No such customer: 'cus_stale'")
            return {"id": customer_id}

        stripe.Customer.retrieve.side_effect = retrieve
        stripe.Customer.list.return_value = {"data": [{"id": "cus_stale"}]}
        stripe.Customer.create.return_value = {"id": "cus_new"}
        stripe.checkout.Session.create.return_value = {"url": "https://checkout.stripe.test/cs_1"}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(user.stripe_customer_id, "cus_new")
        stripe.Customer.create.assert_called_once()

    def test_checkout_uses_price_data_for_dollar_amounts(self) -> None:
        user = _user()
        stripe = MagicMock()
        stripe.Customer.list.return_value = {"data": []}
        stripe.Customer.create.return_value = {"id": "cus_new"}
        stripe.Product.list.return_value = {"data": []}
        stripe.Product.create.return_value = {"id": "prod_pro"}
        stripe.Price.create.return_value = {"id": "price_created"}
        stripe.checkout.Session.create.return_value = {"url": "https://checkout.stripe.test/cs_amt"}
        with patch(
            "app.billing.stripe.get_settings",
            return_value=_settings(stripe_price_basic="0", stripe_price_pro="20", stripe_price_premium="50"),
        ), patch("app.billing.stripe._stripe_mod", return_value=stripe):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro", "return_to": "/pricing"})
        self.assertEqual(res.status_code, 200)
        kwargs = stripe.checkout.Session.create.call_args.kwargs
        self.assertEqual(kwargs["line_items"][0]["price"], "price_created")
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
        body = res.json()
        self.assertEqual(body["amounts"]["pro"], 20)
        self.assertTrue(body["prices"]["pro"])
        self.assertEqual(body["api"]["amounts"]["api_builder"], 5)
        self.assertEqual(body["yearly_discount"], 0.3)
        self.assertEqual(body["yearly_amounts"]["pro"], 168)  # round(20 * 12 * 0.7)
        self.assertEqual(body["yearly_amounts"]["premium"], 420)  # round(50 * 12 * 0.7)
        self.assertTrue(body["yearly_prices"]["pro"])
        self.assertEqual(body["api"]["yearly_amounts"]["api_builder"], 42)

    def test_checkout_invalid_interval_defaults_to_month(self) -> None:
        user = _user()
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod"
        ) as stripe_mod:
            stripe = stripe_mod.return_value
            stripe.Customer.list.return_value = {"data": []}
            stripe.Customer.create.return_value = {"id": "cus_new"}
            stripe.checkout.Session.create.return_value = {"url": "https://checkout.stripe.test/cs_1"}
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro", "interval": "weekly"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            stripe.checkout.Session.create.call_args.kwargs["metadata"]["fileworks_interval"],
            "month",
        )

    def test_checkout_uses_configured_yearly_price_id(self) -> None:
        user = _user()
        with patch(
            "app.billing.stripe.get_settings",
            return_value=_settings(stripe_price_pro_yearly="price_pro_year"),
        ), patch("app.billing.stripe._stripe_mod") as stripe_mod:
            stripe = stripe_mod.return_value
            stripe.Customer.list.return_value = {"data": []}
            stripe.Customer.create.return_value = {"id": "cus_new"}
            stripe.checkout.Session.create.return_value = {"url": "https://checkout.stripe.test/year"}
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro", "interval": "year"})
        self.assertEqual(res.status_code, 200)
        kwargs = stripe.checkout.Session.create.call_args.kwargs
        self.assertEqual(kwargs["line_items"], [{"price": "price_pro_year", "quantity": 1}])
        self.assertEqual(kwargs["metadata"]["fileworks_interval"], "year")

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

    def test_existing_subscriber_confirms_plan_in_portal(self) -> None:
        user = _user("pro")
        user.stripe_subscription_id = "sub_1"
        user.stripe_customer_id = "cus_1"
        stripe = MagicMock()
        stripe.Customer.retrieve.side_effect = lambda cid, **_: {"id": cid}
        stripe.Subscription.retrieve.return_value = {
            "id": "sub_1",
            "status": "active",
            "items": {"data": [{"id": "si_1"}]},
        }
        stripe.Price.retrieve.side_effect = lambda pid, **_: {"id": pid, "product": f"prod_{pid}"}
        stripe.billing_portal.Configuration.list.return_value = {
            "data": [{"id": "bpc_1", "metadata": {"fileworks": "no_refund_cancel"}}]
        }
        stripe.billing_portal.Session.create.return_value = {"url": "https://billing.stripe.test/confirm"}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "premium"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["url"], "https://billing.stripe.test/confirm")
        self.assertFalse(res.json()["updated"])
        stripe.checkout.Session.create.assert_not_called()
        flow = stripe.billing_portal.Session.create.call_args.kwargs["flow_data"]
        self.assertEqual(flow["type"], "subscription_update_confirm")
        self.assertEqual(flow["subscription_update_confirm"]["subscription"], "sub_1")
        self.assertEqual(flow["subscription_update_confirm"]["items"][0]["price"], "price_premium")

    def test_existing_subscriber_does_not_open_second_checkout(self) -> None:
        user = _user("pro")
        user.stripe_subscription_id = "sub_1"
        user.stripe_customer_id = "cus_1"
        stripe = MagicMock()
        stripe.Customer.retrieve.side_effect = lambda cid, **_: {"id": cid}
        stripe.Subscription.retrieve.return_value = {
            "id": "sub_1",
            "status": "active",
            "items": {"data": [{"id": "si_1"}]},
        }
        stripe.Price.retrieve.side_effect = lambda pid, **_: {"id": pid, "product": f"prod_{pid}"}
        stripe.billing_portal.Configuration.list.return_value = {
            "data": [{"id": "bpc_1", "metadata": {"fileworks": "no_refund_cancel"}}]
        }
        stripe.billing_portal.Session.create.side_effect = RuntimeError("portal down")
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "premium"})
        self.assertEqual(res.status_code, 502)
        stripe.checkout.Session.create.assert_not_called()

    def test_canceled_subscriber_uses_checkout(self) -> None:
        user = _user("basic")
        user.stripe_customer_id = "cus_1"
        user.stripe_subscription_id = "sub_old"
        stripe = MagicMock()
        stripe.Customer.retrieve.side_effect = lambda cid, **_: {"id": cid}
        stripe.Subscription.retrieve.return_value = {"id": "sub_old", "status": "canceled"}
        stripe.Subscription.list.return_value = {"data": [{"id": "sub_old", "status": "canceled"}]}
        stripe.checkout.Session.create.return_value = {"url": "https://checkout.stripe.test/cs_new"}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["url"], "https://checkout.stripe.test/cs_new")
        stripe.billing_portal.Session.create.assert_not_called()

    def test_checkout_blocks_downgrade_over_quota(self) -> None:
        user = _user("premium")

        class FakeDb:
            def get(self, *_a, **_k):
                return user

            def add(self, *_a, **_k):
                return None

            def scalar(self, _q):
                return 200

        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=MagicMock()
        ):
            client = TestClient(self._app(user, FakeDb()))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["detail"]["code"], "quota_exceeds_plan")

    def test_portal_requires_customer(self) -> None:
        user = _user()
        stripe = MagicMock()
        stripe.Customer.list.return_value = {"data": []}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/portal")
        self.assertEqual(res.status_code, 400)
        self.assertIn("Subscribe from Pricing", res.json()["detail"])

    def test_portal_attaches_customer_by_email(self) -> None:
        user = _user("pro")
        stripe = MagicMock()
        stripe.Customer.retrieve.side_effect = lambda cid, **_: {"id": cid}
        stripe.Customer.list.return_value = {"data": [{"id": "cus_from_email"}]}
        stripe.Price.retrieve.side_effect = lambda pid, **_: {"id": pid, "product": f"prod_{pid}"}
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
        self.assertEqual(user.stripe_customer_id, "cus_from_email")
        self.assertEqual(
            stripe.billing_portal.Session.create.call_args.kwargs["customer"],
            "cus_from_email",
        )

    def test_portal_returns_url(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        stripe = MagicMock()
        stripe.Customer.retrieve.side_effect = lambda cid, **_: {"id": cid}
        stripe.Price.retrieve.side_effect = lambda pid, **_: {"id": pid, "product": f"prod_{pid}"}
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
        update = stripe.billing_portal.Configuration.modify.call_args.kwargs["features"]["subscription_update"]
        self.assertTrue(update["enabled"])
        self.assertEqual(update["default_allowed_updates"], ["price"])

    def test_portal_creates_no_refund_cancel_config(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        stripe = MagicMock()
        stripe.Customer.retrieve.side_effect = lambda cid, **_: {"id": cid}
        stripe.Price.retrieve.side_effect = lambda pid, **_: {"id": pid, "product": f"prod_{pid}"}
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
        update = created["features"]["subscription_update"]
        self.assertTrue(update["enabled"])
        self.assertEqual(update["default_allowed_updates"], ["price"])
        self.assertEqual(
            update["products"],
            [
                {"product": "prod_price_pro", "prices": ["price_pro"]},
                {"product": "prod_price_premium", "prices": ["price_premium"]},
            ],
        )
        self.assertEqual(stripe.billing_portal.Session.create.call_args.kwargs["configuration"], "bpc_new")

    def test_webhook_rejects_bad_signature(self) -> None:
        with patch("app.api.billing_routes.construct_webhook_event", side_effect=HTTPException(status_code=400, detail="bad")):
            app = FastAPI()
            app.include_router(billing_router, prefix="/api")
            app.dependency_overrides[get_db] = lambda: MagicMock()
            client = TestClient(app)
            res = client.post("/api/billing/webhook", content=b"{}", headers={"stripe-signature": "nope"})
        self.assertEqual(res.status_code, 400)

    def test_sync_route_returns_current_plan(self) -> None:
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
            client = TestClient(self._app(user))
            res = client.post("/api/billing/sync")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["plan"], "basic")
        self.assertEqual(user.plan, "basic")

    def test_instant_plan_change_blocked_when_stripe_on(self) -> None:
        user = _user()
        with patch("app.api.auth_routes.stripe_billing_enabled", return_value=True):
            client = TestClient(self._app(user))
            res = client.post("/api/me/plan", json={"plan": "pro"})
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()["detail"]["code"], "billing_required")

    def test_portal_confirm_return_url_uses_billing_return(self) -> None:
        user = _user("pro")
        user.stripe_subscription_id = "sub_1"
        user.stripe_customer_id = "cus_1"
        stripe = _portal_stripe()
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "premium", "return_to": "/pricing"})
        self.assertEqual(res.status_code, 200)
        kwargs = stripe.billing_portal.Session.create.call_args.kwargs
        self.assertEqual(kwargs["return_url"], "http://localhost:3000/pricing?billing=return")
        self.assertEqual(kwargs["customer"], "cus_1")

    def test_active_sub_from_customer_list_uses_portal(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        stripe = _portal_stripe()
        stripe.Subscription.list.return_value = {
            "data": [
                {
                    "id": "sub_listed",
                    "status": "active",
                    "items": {"data": [{"id": "si_listed"}]},
                }
            ]
        }
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "premium"})
        self.assertEqual(res.status_code, 200)
        stripe.checkout.Session.create.assert_not_called()
        flow = stripe.billing_portal.Session.create.call_args.kwargs["flow_data"]
        self.assertEqual(flow["subscription_update_confirm"]["subscription"], "sub_listed")
        self.assertEqual(flow["subscription_update_confirm"]["items"][0]["id"], "si_listed")

    def test_active_sub_without_item_id_does_not_checkout(self) -> None:
        user = _user("pro")
        user.stripe_subscription_id = "sub_1"
        user.stripe_customer_id = "cus_1"
        stripe = _portal_stripe()
        stripe.Subscription.retrieve.return_value = {"id": "sub_1", "status": "active", "items": {"data": []}}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "premium"})
        self.assertEqual(res.status_code, 502)
        stripe.checkout.Session.create.assert_not_called()

    def test_portal_confirm_uses_stable_dollar_price(self) -> None:
        user = _user("pro")
        user.stripe_subscription_id = "sub_1"
        user.stripe_customer_id = "cus_1"
        stripe = _portal_stripe()
        stripe.Product.list.return_value = {
            "data": [
                {"id": "prod_pro", "metadata": {"fileworks_plan": "pro"}},
                {"id": "prod_premium", "metadata": {"fileworks_plan": "premium"}},
            ]
        }

        def prices(**kwargs):
            product = kwargs.get("product")
            amount = 2000 if product == "prod_pro" else 5000
            return {
                "data": [
                    {
                        "id": f"price_{product}",
                        "unit_amount": amount,
                        "recurring": {"interval": "month"},
                    }
                ]
            }

        stripe.Price.list.side_effect = prices
        with patch(
            "app.billing.stripe.get_settings",
            return_value=_settings(stripe_price_basic="0", stripe_price_pro="20", stripe_price_premium="50"),
        ), patch("app.billing.stripe._stripe_mod", return_value=stripe):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "premium"})
        self.assertEqual(res.status_code, 200)
        stripe.checkout.Session.create.assert_not_called()
        flow = stripe.billing_portal.Session.create.call_args.kwargs["flow_data"]
        self.assertEqual(flow["subscription_update_confirm"]["items"][0]["price"], "price_prod_premium")

    def test_checkout_rejects_same_plan(self) -> None:
        user = _user("pro")
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=MagicMock()
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["detail"]["code"], "plan_invalid")

    def test_checkout_rejects_missing_price(self) -> None:
        user = _user()
        with patch(
            "app.billing.stripe.get_settings",
            return_value=_settings(stripe_price_pro="0", stripe_price_premium="price_premium"),
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["detail"]["code"], "price_missing")

    def test_checkout_and_portal_require_stripe(self) -> None:
        user = _user()
        with patch(
            "app.billing.stripe.get_settings",
            return_value=_settings(stripe_secret_key=None),
        ):
            client = TestClient(self._app(user))
            self.assertEqual(client.post("/api/billing/checkout", json={"plan": "pro"}).status_code, 503)
            self.assertEqual(client.post("/api/billing/portal").status_code, 503)
            self.assertEqual(client.post("/api/billing/confirm", json={"session_id": "cs"}).status_code, 503)

    def test_checkout_empty_url_is_502(self) -> None:
        user = _user()
        stripe = MagicMock()
        stripe.Customer.list.return_value = {"data": []}
        stripe.Customer.create.return_value = {"id": "cus_new"}
        stripe.checkout.Session.create.return_value = {"url": ""}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 502)

    def test_checkout_stripe_error_is_502(self) -> None:
        user = _user()
        stripe = MagicMock()
        stripe.Customer.list.return_value = {"data": []}
        stripe.Customer.create.return_value = {"id": "cus_new"}
        stripe.checkout.Session.create.side_effect = RuntimeError("card_error")
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/checkout", json={"plan": "pro"})
        self.assertEqual(res.status_code, 502)
        self.assertIn("card_error", res.json()["detail"])

    def test_portal_empty_url_and_stripe_error_are_502(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        stripe = _portal_stripe()
        stripe.billing_portal.Session.create.return_value = {"url": ""}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            empty = TestClient(self._app(user)).post("/api/billing/portal")
        self.assertEqual(empty.status_code, 502)
        stripe.billing_portal.Session.create.side_effect = RuntimeError("portal down")
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            failed = TestClient(self._app(user)).post("/api/billing/portal")
        self.assertEqual(failed.status_code, 502)

    def test_confirm_rejects_other_account_and_bad_session(self) -> None:
        user = _user()
        stripe = MagicMock()
        stripe.checkout.Session.retrieve.return_value = {
            "client_reference_id": str(uuid4()),
            "metadata": {"user_id": str(uuid4()), "plan": "pro"},
        }
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            forbidden = client.post("/api/billing/confirm", json={"session_id": "cs_1"})
        self.assertEqual(forbidden.status_code, 403)
        stripe.checkout.Session.retrieve.side_effect = RuntimeError("no such session")
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            bad = TestClient(self._app(user)).post("/api/billing/confirm", json={"session_id": "cs_bad"})
        self.assertEqual(bad.status_code, 400)

    def test_sync_reports_cancel_at_period_end(self) -> None:
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
            "items": {"data": [{"price": {"id": "price_pro"}}]},
        }
        stripe.Subscription.list.return_value = {"data": []}
        settings = _settings()
        with patch("app.billing.stripe.get_settings", return_value=settings), patch(
            "app.api.auth_routes.get_settings", return_value=settings
        ), patch("app.billing.stripe._stripe_mod", return_value=stripe):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/sync")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["plan"], "pro")
        self.assertTrue(res.json()["cancel_at_period_end"])
        self.assertTrue(res.json()["current_period_end"])

    def test_me_never_calls_stripe(self) -> None:
        """Session checks gate the signed-in UI, so they must not wait on Stripe."""
        user = _user("pro")
        user.stripe_customer_id = "cus_1"
        user.stripe_subscription_id = "sub_1"
        stripe = MagicMock()
        settings = _settings()
        with patch("app.billing.stripe.get_settings", return_value=settings), patch(
            "app.api.auth_routes.get_settings", return_value=settings
        ), patch("app.billing.stripe._stripe_mod", return_value=stripe):
            client = TestClient(self._app(user))
            res = client.get("/api/me")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["plan"], "pro")
        self.assertTrue(res.json()["billing"]["enabled"])
        stripe.Subscription.retrieve.assert_not_called()
        stripe.Subscription.list.assert_not_called()
        stripe.Customer.list.assert_not_called()

    def test_portal_picks_email_customer_with_active_sub(self) -> None:
        user = _user("pro")
        stripe = _portal_stripe()
        stripe.Customer.list.return_value = {"data": [{"id": "cus_old"}, {"id": "cus_live"}]}

        def list_subs(**kwargs):
            customer = kwargs.get("customer")
            if customer == "cus_live":
                return {
                    "data": [{"id": "sub_live", "status": "active", "items": {"data": [{"id": "si_1"}]}}]
                }
            return {"data": [{"id": "sub_old", "status": "canceled"}]}

        stripe.Subscription.list.side_effect = list_subs
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            client = TestClient(self._app(user))
            res = client.post("/api/billing/portal")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(user.stripe_customer_id, "cus_live")
        self.assertEqual(stripe.billing_portal.Session.create.call_args.kwargs["customer"], "cus_live")


class StripeObjectAndWebhookTests(unittest.TestCase):
    def test_list_subscriptions_falls_back_when_expand_too_deep(self) -> None:
        from app.billing.stripe import _list_customer_subscriptions

        stripe = MagicMock()
        stripe.Subscription.list.side_effect = [
            RuntimeError("You cannot expand more than 4 levels of a property."),
            {"data": [{"id": "sub_1", "status": "active", "items": {"data": []}}]},
        ]
        rows = _list_customer_subscriptions(stripe, "cus_1")
        self.assertEqual(len(rows), 1)
        self.assertEqual(stripe.Subscription.list.call_count, 2)
        self.assertNotIn("expand", stripe.Subscription.list.call_args_list[1].kwargs)

    def test_amount_helpers(self) -> None:
        self.assertEqual(parse_amount_dollars("12"), 12)
        self.assertEqual(parse_amount_dollars("12.0"), 12)
        self.assertIsNone(parse_amount_dollars("price_pro"))
        self.assertIsNone(parse_amount_dollars("nope"))
        self.assertEqual(plan_amount_dollars("pro", _settings(stripe_price_pro="15")), 15)
        self.assertEqual(plan_amount_dollars("pro", _settings(stripe_price_pro="price_pro")), 5)

    def test_as_dict_accepts_stripe_objects(self) -> None:
        self.assertEqual(_as_dict({"id": "x"}), {"id": "x"})

        class StripeLike:
            def to_dict(self):
                return {"id": "sub_1", "status": "active"}

        self.assertEqual(_as_dict(StripeLike())["id"], "sub_1")
        self.assertEqual(_as_dict([("id", "cus_1")]), {"id": "cus_1"})
        self.assertEqual(_as_dict(object()), {})

    def test_apply_subscription_past_due_keeps_paid_plan(self) -> None:
        user = _user("pro")
        plan = apply_subscription(
            user,
            {
                "id": "sub_1",
                "status": "past_due",
                "customer": {"id": "cus_1"},
                "items": {"data": [{"price": {"id": "price_premium"}}]},
            },
            _settings(),
        )
        self.assertEqual(plan, "premium")
        self.assertEqual(user.stripe_customer_id, "cus_1")

    def test_product_display_names_match_public_labels(self) -> None:
        self.assertEqual(_product_display_name("basic"), "FileWorks Casual")
        self.assertEqual(_product_display_name("pro"), "FileWorks Daily")
        self.assertEqual(_product_display_name("premium"), "FileWorks Expert")
        self.assertEqual(_product_display_name("api_free"), "FileWorks API Free")
        self.assertEqual(_product_display_name("api_builder"), "FileWorks API Daily")
        self.assertEqual(_product_display_name("api_scale"), "FileWorks API Expert")
        self.assertEqual(_product_display_name("api_business"), "FileWorks API Business")

    def test_plan_from_name_accepts_public_and_legacy_labels(self) -> None:
        self.assertEqual(_plan_from_name("FileWorks Daily"), "pro")
        self.assertEqual(_plan_from_name("FileWorks Pro"), "pro")
        self.assertEqual(_plan_from_name("FileWorks Expert"), "premium")
        self.assertEqual(_plan_from_name("FileWorks Premium"), "premium")
        self.assertEqual(_plan_from_name("FileWorks Casual"), "basic")
        self.assertEqual(_plan_from_name("FileWorks API Daily"), "api_builder")
        self.assertEqual(_plan_from_name("FileWorks API Builder"), "api_builder")
        self.assertEqual(_plan_from_name("FileWorks API Expert"), "api_scale")
        self.assertEqual(_plan_from_name("FileWorks API Scale"), "api_scale")

    def test_apply_subscription_reads_product_name(self) -> None:
        user = _user()
        plan = apply_subscription(
            user,
            {
                "id": "sub_1",
                "status": "active",
                "customer": "cus_1",
                "items": {"data": [{"price": {"id": "price_adhoc", "product": {"name": "FileWorks Premium"}}}]},
            },
            _settings(stripe_price_pro="20", stripe_price_premium="50"),
        )
        self.assertEqual(plan, "premium")

    def test_subscription_view_empty_and_item_period(self) -> None:
        empty = subscription_view(None)
        self.assertIsNone(empty["subscription_status"])
        self.assertFalse(empty["cancel_at_period_end"])
        self.assertIsNone(empty["current_period_end"])

    def test_webhook_object_can_be_stripe_like(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_2"
        db = MagicMock()
        db.scalar.return_value = user

        class StripeLike:
            def to_dict(self):
                return {
                    "id": "sub_2",
                    "status": "active",
                    "customer": "cus_2",
                    "items": {"data": [{"price": {"id": "price_premium"}}]},
                }

        with patch("app.billing.stripe.get_settings", return_value=_settings()):
            assigned = handle_webhook_event(
                db,
                {"type": "customer.subscription.updated", "data": {"object": StripeLike()}},
            )
        self.assertEqual(assigned, "premium")

    def test_webhook_deletes_current_subscription(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_2"
        user.stripe_subscription_id = "sub_1"
        db = MagicMock()
        db.scalar.return_value = user
        with patch("app.billing.stripe.get_settings", return_value=_settings()):
            assigned = handle_webhook_event(
                db,
                {
                    "type": "customer.subscription.deleted",
                    "data": {"object": {"id": "sub_1", "status": "canceled", "customer": "cus_2"}},
                },
            )
        self.assertEqual(assigned, "basic")
        self.assertEqual(user.plan, "basic")
        self.assertIsNone(user.stripe_subscription_id)

    def test_webhook_ignores_unknown_customer_and_other_events(self) -> None:
        db = MagicMock()
        db.get.return_value = None
        db.scalar.return_value = None
        with patch("app.billing.stripe.get_settings", return_value=_settings()):
            self.assertIsNone(
                handle_webhook_event(
                    db,
                    {
                        "type": "customer.subscription.updated",
                        "data": {"object": {"id": "sub_x", "status": "active", "customer": "cus_missing"}},
                    },
                )
            )
            self.assertIsNone(handle_webhook_event(db, {"type": "invoice.paid", "data": {"object": {}}}))
            self.assertIsNone(
                handle_webhook_event(
                    db,
                    {
                        "type": "checkout.session.completed",
                        "data": {"object": {"client_reference_id": str(uuid4()), "metadata": {"plan": "pro"}}},
                    },
                )
            )

    def test_checkout_completed_applies_expanded_subscription(self) -> None:
        user = _user()
        db = MagicMock()
        db.get.return_value = user
        stripe = MagicMock()
        stripe.Subscription.list.return_value = {
            "data": [
                {"id": "sub_old", "status": "active"},
                {"id": "sub_new", "status": "active"},
            ]
        }
        user.stripe_customer_id = "cus_9"
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            assigned = apply_checkout_session(
                db,
                {
                    "client_reference_id": str(user.id),
                    "customer": "cus_9",
                    "subscription": {
                        "id": "sub_new",
                        "status": "active",
                        "customer": "cus_9",
                        "items": {"data": [{"price": {"id": "price_premium"}}]},
                    },
                    "metadata": {"user_id": str(user.id), "plan": "pro"},
                },
            )
        self.assertEqual(assigned, "premium")
        self.assertEqual(user.plan, "premium")
        stripe.Subscription.cancel.assert_called_once_with("sub_old", prorate=False)

    def test_sync_attaches_customer_by_email(self) -> None:
        user = _user("basic")
        stripe = MagicMock()
        stripe.Customer.retrieve.side_effect = lambda cid, **_: {"id": cid}
        stripe.Customer.list.return_value = {"data": [{"id": "cus_from_email"}]}
        stripe.Subscription.list.return_value = {
            "data": [
                {
                    "id": "sub_1",
                    "status": "active",
                    "customer": "cus_from_email",
                    "items": {"data": [{"price": {"id": "price_pro"}}]},
                }
            ]
        }
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            view = sync_user_subscription(MagicMock(), user)
        self.assertEqual(user.stripe_customer_id, "cus_from_email")
        self.assertEqual(user.plan, "pro")
        self.assertEqual(view["subscription_status"], "active")

    def test_sync_without_stripe_ids_is_noop(self) -> None:
        user = _user("pro")
        stripe = MagicMock()
        stripe.Customer.list.return_value = {"data": []}
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            view = sync_user_subscription(MagicMock(), user)
        self.assertEqual(view, {})
        self.assertEqual(user.plan, "pro")

    def test_sync_clears_stale_customer_id(self) -> None:
        user = _user("pro")
        user.stripe_customer_id = "cus_stale"
        user.stripe_subscription_id = "sub_old"
        stripe = MagicMock()
        stripe.Subscription.retrieve.return_value = None
        stripe.Subscription.list.side_effect = RuntimeError("No such customer: 'cus_stale'")
        db = MagicMock()
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            sync_user_subscription(db, user)
        self.assertIsNone(user.stripe_customer_id)
        self.assertIsNone(user.stripe_subscription_id)
        self.assertEqual(user.plan, "basic")
        db.add.assert_called()

    def test_construct_webhook_event_validates_secret_and_signature(self) -> None:
        with patch("app.billing.stripe.get_settings", return_value=_settings(stripe_webhook_secret="")):
            with self.assertRaises(HTTPException) as missing_secret:
                construct_webhook_event(b"{}", "sig")
        self.assertEqual(missing_secret.exception.status_code, 503)
        with patch("app.billing.stripe.get_settings", return_value=_settings()):
            with self.assertRaises(HTTPException) as missing_sig:
                construct_webhook_event(b"{}", None)
        self.assertEqual(missing_sig.exception.status_code, 400)
        stripe = MagicMock()
        stripe.Webhook.construct_event.side_effect = RuntimeError("bad sig")
        with patch("app.billing.stripe.get_settings", return_value=_settings()), patch(
            "app.billing.stripe._stripe_mod", return_value=stripe
        ):
            with self.assertRaises(HTTPException) as bad:
                construct_webhook_event(b"{}", "sig_bad")
        self.assertEqual(bad.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
