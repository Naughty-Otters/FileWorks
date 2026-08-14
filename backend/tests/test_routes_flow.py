from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.auth_routes import router as auth_router
from app.api.routes import router
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.auth.tokens import issue_access_token
from app.db.session import get_db
from app.storage.base import DocumentRecord, utc_now_iso


def _app(principal: Principal) -> FastAPI:
    app = FastAPI()
    app.include_router(router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.dependency_overrides[get_principal] = lambda: principal
    app.dependency_overrides[get_db] = lambda: None
    return app


class ExtractFlowTests(unittest.TestCase):
    def test_extract_guest_forbidden(self) -> None:
        principal = Principal(plan=get_plan("anonymous"), anonymous_id="anonuser1")
        client = TestClient(_app(principal))
        res = client.post(
            "/api/extract",
            files={"file": ("note.png", b"png-bytes", "image/png")},
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["detail"]["feature"], "extract")

    def test_extract_basic_succeeds(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        long = "abcdefghij" * 8
        with patch(
            "app.api.routes.convert_document",
            return_value={
                "markdown": long,
                "json": {"text": long},
                "pages": [{"markdown": long}],
                "engine": "ocr",
                "page_count": 1,
                "regions": [],
            },
        ), patch("app.api.routes.get_document_store") as store_fn:
            store = MagicMock()
            store.save_document.return_value = DocumentRecord(
                id="doc1",
                filename="note.png",
                content_type="image/png",
                size_bytes=9,
                source_key="s",
                result_key="r",
                created_at=utc_now_iso(),
                engine="ocr",
                page_count=1,
                output_format="both",
                markdown=long,
                owner_id=str(user.id),
            )
            store_fn.return_value = store
            res = client.post(
                "/api/extract",
                files={"file": ("note.png", b"png-bytes", "image/png")},
            )
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertNotIn("Sign in", body["markdown"])
        self.assertEqual(body["markdown"], long)

    def test_extract_prefer_structure_false_keeps_flag_off(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        captured: dict = {}

        def fake_convert(*_args, **kwargs):
            captured["options"] = kwargs.get("options")
            return {
                "markdown": "abcdefghij" * 8,
                "json": {},
                "pages": [],
                "engine": "anydoc",
                "provider": "anydoc",
                "page_count": 1,
                "regions": [],
            }

        with patch("app.api.routes.convert_document", side_effect=fake_convert), patch(
            "app.api.routes.get_document_store"
        ) as store_fn:
            store = MagicMock()
            store.save_document.return_value = DocumentRecord(
                id="doc1",
                filename="report.pdf",
                content_type="application/pdf",
                size_bytes=8,
                source_key="s",
                result_key="r",
                created_at=utc_now_iso(),
                engine="anydoc",
                page_count=1,
                output_format="both",
                markdown="abcdefghij" * 8,
                owner_id=str(user.id),
            )
            store_fn.return_value = store
            res = client.post(
                "/api/extract",
                data={"prefer_structure": "false"},
                files={"file": ("report.pdf", b"%PDF-1.4", "application/pdf")},
            )
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(captured.get("options"))
        self.assertFalse(captured["options"].prefer_structure)

    def test_extract_prefer_structure_true_keeps_flag_on(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        captured: dict = {}

        def fake_convert(*_args, **kwargs):
            captured["options"] = kwargs.get("options")
            return {
                "markdown": "abcdefghij" * 8,
                "json": {},
                "pages": [],
                "engine": "ocr",
                "provider": "ocr",
                "page_count": 1,
                "regions": [],
            }

        with patch("app.api.routes.convert_document", side_effect=fake_convert), patch(
            "app.api.routes.get_document_store"
        ) as store_fn:
            store = MagicMock()
            store.save_document.return_value = DocumentRecord(
                id="doc1",
                filename="report.pdf",
                content_type="application/pdf",
                size_bytes=8,
                source_key="s",
                result_key="r",
                created_at=utc_now_iso(),
                engine="ocr",
                page_count=1,
                output_format="both",
                markdown="abcdefghij" * 8,
                owner_id=str(user.id),
            )
            store_fn.return_value = store
            res = client.post(
                "/api/extract",
                data={"prefer_structure": "true"},
                files={"file": ("report.pdf", b"%PDF-1.4", "application/pdf")},
            )
        self.assertEqual(res.status_code, 200)
        self.assertTrue(captured["options"].prefer_structure)

    def test_extract_convert_error_is_500(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        with patch("app.api.routes.convert_document", side_effect=RuntimeError("boom")), patch(
            "app.api.routes.get_document_store", return_value=MagicMock()
        ):
            res = client.post(
                "/api/extract",
                files={"file": ("note.png", b"png-bytes", "image/png")},
            )
        self.assertEqual(res.status_code, 500)

    def test_extract_missing_file(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=get_plan("basic"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        res = client.post("/api/extract")
        self.assertEqual(res.status_code, 400)

    def test_extract_ai_forbidden(self) -> None:
        from dataclasses import replace

        user = SimpleNamespace(id=uuid4(), email="b@x.co", plan="basic")
        principal = Principal(plan=replace(get_plan("basic"), ai=False), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        res = client.post(
            "/api/extract",
            data={"use_ai": "true"},
            files={"file": ("note.png", b"png-bytes", "image/png")},
        )
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()["detail"]["feature"], "extract.ai")

    def test_extract_saves_history_for_pro(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="p@x.co", plan="pro")
        principal = Principal(plan=get_plan("pro"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        store = MagicMock()
        store.save_document.return_value = DocumentRecord(
            id="doc1",
            filename="note.png",
            content_type="image/png",
            size_bytes=9,
            source_key="s",
            result_key="r",
            created_at=utc_now_iso(),
            engine="ocr",
            page_count=1,
            output_format="both",
            markdown="# hi",
            owner_id=str(user.id),
        )
        with patch("app.api.routes.convert_document", return_value={"markdown": "# hi", "engine": "ocr", "page_count": 1, "json": {}, "pages": []}), patch(
            "app.api.routes.get_document_store", return_value=store
        ):
            res = client.post(
                "/api/extract",
                files={"file": ("note.png", b"png-bytes", "image/png")},
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["engine"], "FileWorks")
        self.assertNotIn("AnyDoc", str(res.json()))
        store.save_document.assert_called()

    def test_history_owned_roundtrip(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="p@x.co", plan="pro")
        principal = Principal(plan=get_plan("pro"), user=user)  # type: ignore[arg-type]
        client = TestClient(_app(principal))
        record = DocumentRecord(
            id="doc1",
            filename="note.png",
            content_type="image/png",
            size_bytes=9,
            source_key="docs/doc1/source.png",
            result_key="docs/doc1/result.json",
            created_at=utc_now_iso(),
            engine="ocr",
            page_count=1,
            output_format="both",
            markdown="# hi",
            json_data={},
            pages=[],
            owner_id=str(user.id),
        )
        store = MagicMock()
        store.list_documents.return_value = [record]
        store.get_document.return_value = record
        store.load_media_files.return_value = {}
        store.get_source_bytes.return_value = (b"png", "note.png", "image/png")
        store.delete_document.return_value = True
        with patch("app.api.routes.get_document_store", return_value=store):
            listed = client.get("/api/history")
            self.assertEqual(listed.status_code, 200)
            self.assertEqual(listed.json()["items"][0]["id"], "doc1")
            self.assertEqual(listed.json()["items"][0]["engine"], "FileWorks")
            detail = client.get("/api/history/doc1")
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["engine"], "FileWorks")
            self.assertNotIn("AnyDoc", str(detail.json()))
            file_res = client.get("/api/history/doc1/file")
            self.assertEqual(file_res.status_code, 200)
            deleted = client.delete("/api/history/doc1")
            self.assertEqual(deleted.status_code, 200)
            store.get_document.return_value = None
            missing = client.get("/api/history/missing")
            self.assertEqual(missing.status_code, 404)

    def test_history_forbidden_without_user(self) -> None:
        principal = Principal(plan=get_plan("anonymous"), anonymous_id="anonuser1")
        client = TestClient(_app(principal))
        res = client.get("/api/history/doc1")
        self.assertEqual(res.status_code, 403)

    def test_me_guest(self) -> None:
        principal = Principal(plan=get_plan("anonymous"), anonymous_id="anonuser1")
        client = TestClient(_app(principal))
        res = client.get("/api/me")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["plan"], "anonymous")
        self.assertIsNone(res.json()["user"])


class AuthRouteTests(unittest.TestCase):
    def test_google_without_db(self) -> None:
        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: None
        client = TestClient(app)
        res = client.post("/api/auth/google", json={"id_token": "x"})
        self.assertEqual(res.status_code, 503)

    def test_google_login_creates_user(self) -> None:
        created: list = []

        class FakeDb:
            def scalar(self, _q):
                return None

            def add(self, obj):
                created.append(obj)
                if getattr(obj, "email", None) and getattr(obj, "id", None) is None:
                    obj.id = uuid4()

            def flush(self):
                pass

            def get(self, _model, _pk):
                return created[0] if created else None

        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: FakeDb()
        client = TestClient(app)
        with patch(
            "app.api.auth_routes.verify_google_id_token",
            return_value={"sub": "g1", "email": "a@b.co", "name": "A", "picture": None},
        ):
            res = client.post("/api/auth/google", json={"id_token": "tok"})
        self.assertEqual(res.status_code, 200)
        self.assertIn("access_token", res.json())

    def test_refresh_invalid(self) -> None:
        class FakeDb:
            def scalar(self, _q):
                return None

        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: FakeDb()
        client = TestClient(app)
        res = client.post("/api/auth/refresh", json={"refresh_token": "nope"})
        self.assertEqual(res.status_code, 401)

    def test_logout_revokes_token(self) -> None:
        row = SimpleNamespace(revoked_at=None)

        class FakeDb:
            def scalar(self, _q):
                return row

        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: FakeDb()
        client = TestClient(app)
        res = client.post("/api/auth/logout", json={"refresh_token": "x"})
        self.assertEqual(res.status_code, 200)
        self.assertIsNotNone(row.revoked_at)

    def test_refresh_success(self) -> None:
        from datetime import datetime, timedelta, timezone
        from app.db.models import User

        user = User(email="a@b.co", google_sub="g1", name="A", plan="basic")
        user.id = uuid4()
        row = SimpleNamespace(
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            revoked_at=None,
            user_id=user.id,
        )

        class FakeDb:
            def scalar(self, _q):
                return row

            def get(self, _model, _pk):
                return user

            def add(self, _obj):
                pass

            def flush(self):
                pass

        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: FakeDb()
        client = TestClient(app)
        res = client.post("/api/auth/refresh", json={"refresh_token": "ok"})
        self.assertEqual(res.status_code, 200)
        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: None
        client = TestClient(app)
        res = client.post("/api/auth/logout", json={"refresh_token": "x"})
        self.assertEqual(res.status_code, 200)

    def test_google_bad_token(self) -> None:
        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: object()
        client = TestClient(app)
        with patch("app.api.auth_routes.verify_google_id_token", side_effect=RuntimeError("bad")):
            res = client.post("/api/auth/google", json={"id_token": "tok"})
        self.assertEqual(res.status_code, 401)

    def test_change_plan_upgrades(self) -> None:
        from app.db.models import User

        user = User(email="a@b.co", google_sub="g1", name="A", plan="basic")
        user.id = uuid4()

        class FakeDb:
            def add(self, _obj):
                pass

            def flush(self):
                pass

            def get(self, _model, _pk):
                return user

            def commit(self):
                pass

        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: FakeDb()
        app.dependency_overrides[get_principal] = lambda: Principal(plan=get_plan("basic"), user=user)
        client = TestClient(app)
        res = client.post("/api/me/plan", json={"plan": "pro"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(user.plan, "pro")
        self.assertEqual(res.json()["plan"], "pro")
        down = client.post("/api/me/plan", json={"plan": "basic"})
        self.assertEqual(down.status_code, 200)
        self.assertEqual(user.plan, "basic")
        same = client.post("/api/me/plan", json={"plan": "basic"})
        self.assertEqual(same.status_code, 400)

    def test_change_plan_user_missing(self) -> None:
        from app.db.models import User

        user = User(email="a@b.co", google_sub="g1", name="A", plan="basic")
        user.id = uuid4()

        class FakeDb:
            def get(self, _model, _pk):
                return None

        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: FakeDb()
        app.dependency_overrides[get_principal] = lambda: Principal(plan=get_plan("basic"), user=user)
        client = TestClient(app)
        res = client.post("/api/me/plan", json={"plan": "pro"})
        self.assertEqual(res.status_code, 401)

    def test_change_plan_requires_user(self) -> None:
        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: object()
        app.dependency_overrides[get_principal] = lambda: Principal(
            plan=get_plan("anonymous"), anonymous_id="anon"
        )
        client = TestClient(app)
        res = client.post("/api/me/plan", json={"plan": "pro"})
        self.assertEqual(res.status_code, 401)

    def test_change_plan_without_db(self) -> None:
        from app.db.models import User

        user = User(email="a@b.co", google_sub="g1", name="A", plan="basic")
        user.id = uuid4()
        app = FastAPI()
        app.include_router(auth_router, prefix="/api")
        app.dependency_overrides[get_db] = lambda: None
        app.dependency_overrides[get_principal] = lambda: Principal(plan=get_plan("basic"), user=user)
        client = TestClient(app)
        res = client.post("/api/me/plan", json={"plan": "pro"})
        self.assertEqual(res.status_code, 503)


class TokenPrincipalTests(unittest.TestCase):
    def test_bearer_user(self) -> None:
        user = SimpleNamespace(id=uuid4(), email="a@b.co", plan="pro", name="A", picture_url=None)
        token = issue_access_token(user_id=user.id, plan="pro", email=user.email)

        class Req:
            headers = {"authorization": f"Bearer {token}"}

        db = MagicMock()
        db.get.return_value = user
        principal = get_principal(Req(), db=db)  # type: ignore[arg-type]
        self.assertEqual(principal.plan.id, "pro")
        self.assertEqual(principal.user_id, user.id)


if __name__ == "__main__":
    unittest.main()
