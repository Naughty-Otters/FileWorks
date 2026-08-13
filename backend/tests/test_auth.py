from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from fastapi import HTTPException

from app.auth.plans import can_change_plan, get_plan, permissions_for
from app.auth.quota import assert_can_extract, quota_snapshot, record_extract
from app.auth.redact import redact_extract_payload
from app.auth.tokens import decode_access_token, hash_token, issue_access_token, new_refresh_token
from app.core.config import Settings, get_settings


class PlansTests(unittest.TestCase):
    def test_unknown_plan_is_guest(self) -> None:
        plan = get_plan("nope")
        self.assertEqual(plan.id, "anonymous")
        self.assertFalse(plan.extract)
        self.assertFalse(plan.full_result)

    def test_empty_plan_is_guest(self) -> None:
        self.assertEqual(get_plan(None).id, "anonymous")

    def test_basic_can_convert_without_ai(self) -> None:
        perms = permissions_for(get_plan("basic"))
        self.assertTrue(perms["extract"])
        self.assertTrue(perms["extract.full_result"])
        self.assertFalse(perms["extract.ai"])
        self.assertTrue(perms["history.read"])

    def test_pro_permissions(self) -> None:
        perms = permissions_for(get_plan("pro"))
        self.assertTrue(perms["extract.ai"])
        self.assertTrue(perms["history.read"])

    def test_plan_upgrade_ranks(self) -> None:
        self.assertTrue(can_change_plan("basic", "pro"))
        self.assertTrue(can_change_plan("pro", "premium"))
        self.assertTrue(can_change_plan("premium", "pro"))
        self.assertTrue(can_change_plan("pro", "basic"))
        self.assertFalse(can_change_plan("basic", "basic"))
        self.assertFalse(can_change_plan("basic", "anonymous"))


class TokenTests(unittest.TestCase):
    def test_issue_and_decode(self) -> None:
        user_id = uuid4()
        token = issue_access_token(user_id=user_id, plan="pro", email="a@b.co")
        payload = decode_access_token(token)
        self.assertEqual(payload["sub"], str(user_id))
        self.assertEqual(payload["plan"], "pro")

    def test_hash_and_refresh(self) -> None:
        raw = new_refresh_token()
        self.assertGreater(len(raw), 20)
        self.assertEqual(len(hash_token(raw)), 64)


class QuotaTests(unittest.TestCase):
    def test_anonymous_cannot_extract(self) -> None:
        snap = quota_snapshot(None, user_id=None, plan=get_plan("anonymous"))
        self.assertIsNone(snap["remaining_day"])
        with self.assertRaises(HTTPException) as ctx:
            assert_can_extract(None, user_id=None, plan=get_plan("anonymous"))
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertEqual(ctx.exception.detail["feature"], "extract")

    def test_basic_can_extract(self) -> None:
        snap = quota_snapshot(None, user_id=None, plan=get_plan("basic"))
        self.assertEqual(snap["remaining_day"], 1)
        assert_can_extract(None, user_id=None, plan=get_plan("basic"))

    def test_record_without_db_is_noop(self) -> None:
        record_extract(None, user_id=None, anonymous_id="x")

    def test_forbidden_plan(self) -> None:
        plan = get_plan("anonymous")
        object.__setattr__(plan, "extract", False) if False else None
        from dataclasses import replace

        blocked = replace(plan, extract=False)
        with self.assertRaises(HTTPException) as ctx:
            assert_can_extract(None, user_id=None, plan=blocked)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_day_quota_exhausted(self) -> None:
        plan = get_plan("basic")
        class FakeDb:
            def scalar(self, _q):
                return 1

        with self.assertRaises(HTTPException) as ctx:
            assert_can_extract(FakeDb(), user_id=uuid4(), plan=plan)
        self.assertEqual(ctx.exception.detail["code"], "quota_day")

    def test_month_quota_exhausted(self) -> None:
        plan = get_plan("pro")
        class FakeDb:
            def scalar(self, _q):
                return 500

        with self.assertRaises(HTTPException) as ctx:
            assert_can_extract(FakeDb(), user_id=uuid4(), plan=plan)
        self.assertEqual(ctx.exception.detail["code"], "quota_month")

    def test_record_extract_adds_event(self) -> None:
        added = []
        class FakeDb:
            def add(self, event):
                added.append(event)

        record_extract(FakeDb(), user_id=uuid4(), anonymous_id="anon")
        self.assertEqual(len(added), 1)


class RedactTests(unittest.TestCase):
    def test_empty_passthrough(self) -> None:
        md, data, pages = redact_extract_payload(None, None, [])
        self.assertIsNone(md)
        self.assertIsNone(data)

    def test_cuts_text_and_pages(self) -> None:
        md, data, pages = redact_extract_payload(
            "abcdefghij" * 4,
            {"text": "abcdefghij" * 4},
            [{"markdown": "abcdefghij" * 4}, "skip"],
        )
        self.assertIn("Sign in", md or "")
        self.assertIn("Sign in", data["text"])
        self.assertIn("Sign in", pages[0]["markdown"])
        self.assertEqual(pages[1], "skip")

    def test_short_text_still_notes_signin(self) -> None:
        md, _, _ = redact_extract_payload("hi", {}, [])
        self.assertIn("Sign in", md or "")


class SettingsTests(unittest.TestCase):
    def test_cors_csv(self) -> None:
        self.assertEqual(
            Settings.parse_cors_origins("http://a.com, http://b.com"),
            ["http://a.com", "http://b.com"],
        )

    def test_cors_json(self) -> None:
        self.assertEqual(
            Settings.parse_cors_origins('["http://a.com"]'),
            ["http://a.com"],
        )

    def test_cors_empty(self) -> None:
        origins = Settings.parse_cors_origins("")
        self.assertIn("http://localhost:3000", origins)

    def test_get_settings_creates_dirs(self) -> None:
        settings = get_settings()
        self.assertTrue(settings.upload_dir.exists())


if __name__ == "__main__":
    unittest.main()
