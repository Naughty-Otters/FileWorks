from __future__ import annotations

import unittest
from unittest.mock import MagicMock
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.key_routes import router as key_router
from app.auth.api_keys import create_api_key, looks_like_api_key
from app.auth.api_plans import convert_credits, get_api_plan, is_api_plan
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.auth.quota import api_quota_snapshot, assert_api_credits, record_api_credits
from app.billing.stripe import apply_subscription, billing_catalog
from app.core.config import Settings
from app.db.models import User
from app.db.session import get_db


def _settings(**overrides: object) -> Settings:
    values = {
        "_env_file": None,
        "jwt_secret": "test-secret-do-not-use-in-prod-please",
        "stripe_secret_key": "sk_test_x",
        "stripe_webhook_secret": "whsec_x",
        "stripe_price_pro": "price_pro",
        "stripe_price_premium": "price_premium",
        "stripe_price_api_builder": "price_api_builder",
        "public_app_url": "http://localhost:3000",
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


class ApiPlanTests(unittest.TestCase):
    def test_credit_math(self) -> None:
        self.assertEqual(convert_credits(page_count=0, enhanced=False), 0)
        self.assertEqual(convert_credits(page_count=4, enhanced=False), 0)
        self.assertEqual(convert_credits(page_count=4, enhanced=True), 4)
        self.assertTrue(is_api_plan("api_scale"))
        self.assertFalse(is_api_plan("pro"))
        self.assertEqual(get_api_plan("nope").id, "api_free")
        self.assertEqual(get_api_plan("api_business").credits_per_month, 2000)
        self.assertEqual(get_api_plan("api_free").standard_pages_per_month, 500)
        self.assertEqual(get_api_plan("api_free").credits_per_month, 2)
        self.assertEqual(get_api_plan("api_free").max_keys, 1)

    def test_quota_blocks_at_zero(self) -> None:
        plan = get_api_plan("api_free")
        db = MagicMock()
        db.scalar.return_value = 5
        snap = api_quota_snapshot(db, user_id=uuid4(), plan=plan)
        self.assertEqual(snap["remaining_credits"], 0)
        with self.assertRaises(HTTPException) as ctx:
            assert_api_credits(db, user_id=uuid4(), plan=plan, enhanced=True)
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail["code"], "quota_credits")

    def test_record_credits_skips_empty(self) -> None:
        db = MagicMock()
        record_api_credits(db, user_id=None, credits=3)
        db.add.assert_not_called()
        record_api_credits(db, user_id=uuid4(), credits=3)
        db.add.assert_called_once()


class ApiKeyHelperTests(unittest.TestCase):
    def test_prefix_and_lookup(self) -> None:
        self.assertTrue(looks_like_api_key("fw_live_abc"))
        self.assertFalse(looks_like_api_key("eyJhbGciOi"))
        db = MagicMock()
        db.scalar.return_value = 0
        user_id = uuid4()
        row, secret = create_api_key(db, user_id=user_id, plan=get_api_plan("api_free"), name="CI")
        self.assertTrue(secret.startswith("fw_live_"))
        self.assertEqual(row.name, "CI")
        self.assertEqual(row.user_id, user_id)
        db.add.assert_called()
        db.flush.assert_called()

    def test_key_limit(self) -> None:
        db = MagicMock()
        db.scalar.return_value = 1
        with self.assertRaises(HTTPException) as ctx:
            create_api_key(db, user_id=uuid4(), plan=get_api_plan("api_free"))
        self.assertEqual(ctx.exception.detail["code"], "api_key_limit")


class ApiKeyRouteTests(unittest.TestCase):
    def test_requires_sign_in(self) -> None:
        app = FastAPI()
        app.include_router(key_router, prefix="/api")
        app.dependency_overrides[get_principal] = lambda: Principal(plan=get_plan("anonymous"))
        app.dependency_overrides[get_db] = lambda: MagicMock()
        res = TestClient(app).get("/api/keys")
        self.assertEqual(res.status_code, 401)


class ApiStripeTests(unittest.TestCase):
    def test_catalog_includes_api_bucket(self) -> None:
        catalog = billing_catalog(_settings())
        self.assertIn("api", catalog)
        self.assertEqual(catalog["api"]["amounts"]["api_builder"], 5)
        self.assertTrue(catalog["api"]["prices"]["api_builder"])
        self.assertFalse(catalog["api"]["prices"]["api_free"])
        self.assertEqual(catalog["amounts"]["pro"], 5)
        self.assertEqual(catalog["yearly_discount"], 0.3)
        self.assertEqual(catalog["yearly_amounts"]["pro"], 42)
        self.assertEqual(catalog["yearly_amounts"]["premium"], 244)
        self.assertEqual(catalog["api"]["yearly_amounts"]["api_builder"], 42)
        self.assertEqual(catalog["api"]["yearly_amounts"]["api_scale"], 244)
        self.assertFalse(catalog["api"]["yearly_prices"]["api_free"])
        self.assertTrue(catalog["api"]["yearly_prices"]["api_builder"])

    def test_apply_api_subscription_does_not_touch_workspace(self) -> None:
        user = User(email="a@b.co", google_sub="g1", name="A", plan="pro")
        user.id = uuid4()
        user.api_plan = "api_free"
        plan = apply_subscription(
            user,
            {
                "id": "sub_api",
                "status": "active",
                "customer": "cus_1",
                "metadata": {"fileworks_product": "api", "plan": "api_builder"},
                "items": {"data": [{"price": {"id": "price_api_builder"}}]},
            },
            _settings(),
        )
        self.assertEqual(plan, "api_builder")
        self.assertEqual(user.api_plan, "api_builder")
        self.assertEqual(user.plan, "pro")
        self.assertEqual(user.stripe_api_subscription_id, "sub_api")
        self.assertIsNone(user.stripe_subscription_id)

    def test_canceled_api_subscription_falls_back_to_free(self) -> None:
        user = User(email="a@b.co", google_sub="g1", plan="premium")
        user.id = uuid4()
        user.api_plan = "api_scale"
        user.stripe_api_subscription_id = "sub_api"
        user.stripe_subscription_id = "sub_ws"
        apply_subscription(
            user,
            {"id": "sub_api", "status": "canceled", "customer": "cus_1"},
            _settings(),
        )
        self.assertEqual(user.api_plan, "api_free")
        self.assertIsNone(user.stripe_api_subscription_id)
        self.assertEqual(user.plan, "premium")
        self.assertEqual(user.stripe_subscription_id, "sub_ws")
