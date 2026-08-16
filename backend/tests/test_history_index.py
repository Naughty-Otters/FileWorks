from __future__ import annotations

import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import router
from app.auth.deps import Principal, get_principal
from app.auth.plans import get_plan
from app.db.history import list_history_summaries, upsert_history_summary
from app.db.models import HistoryDocument
from app.db.session import get_db
from app.storage.base import DocumentRecord, utc_now_iso


class HistoryIndexTests(unittest.TestCase):
    def test_upsert_and_list_skips_s3(self) -> None:
        user_id = uuid4()
        created = datetime(2026, 8, 15, 12, 0, tzinfo=timezone.utc)
        row = HistoryDocument(
            id="doc1",
            user_id=user_id,
            filename="note.png",
            content_type="image/png",
            size_bytes=9,
            engine="ocr",
            page_count=1,
            storage_backend="s3",
            has_markdown=True,
            has_json=True,
            created_at=created,
        )

        class FakeDb:
            def get(self, model, pk):
                if model is HistoryDocument and pk == "doc1":
                    return row
                return None

            def add(self, _obj):
                pass

            def scalars(self, _stmt):
                return SimpleNamespace(all=lambda: [row])

        items = list_history_summaries(FakeDb(), user_id=user_id, limit=20)
        self.assertIsNotNone(items)
        self.assertEqual(items[0]["id"], "doc1")
        self.assertEqual(items[0]["filename"], "note.png")
        self.assertTrue(items[0]["has_markdown"])

        record = DocumentRecord(
            id="doc1",
            filename="renamed.png",
            content_type="image/png",
            size_bytes=12,
            source_key="s",
            result_key="r",
            created_at=utc_now_iso(),
            markdown="# hi",
            json_data={},
            owner_id=str(user_id),
        )
        upsert_history_summary(FakeDb(), record)
        self.assertEqual(row.filename, "renamed.png")
        self.assertEqual(row.size_bytes, 12)

    def test_history_route_uses_db_summaries(self) -> None:
        user_id = uuid4()
        user = SimpleNamespace(id=user_id, email="p@x.co", plan="pro", history_indexed=True)
        row = HistoryDocument(
            id="doc-db",
            user_id=user_id,
            filename="from-db.pdf",
            content_type="application/pdf",
            size_bytes=100,
            engine="ocr",
            page_count=2,
            storage_backend="s3",
            has_markdown=True,
            has_json=False,
            created_at=datetime(2026, 8, 1, tzinfo=timezone.utc),
        )

        class FakeDb:
            def get(self, model, pk):
                if pk == user_id:
                    return user
                return None

            def add(self, _obj):
                pass

            def scalars(self, _stmt):
                return SimpleNamespace(all=lambda: [row])

        store = MagicMock()
        app = FastAPI()
        app.include_router(router, prefix="/api")
        app.dependency_overrides[get_principal] = lambda: Principal(
            plan=get_plan("pro"),
            user=user,  # type: ignore[arg-type]
        )
        app.dependency_overrides[get_db] = lambda: FakeDb()
        with patch("app.api.routes.get_document_store", return_value=store):
            res = TestClient(app).get("/api/history")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["items"][0]["id"], "doc-db")
        self.assertEqual(res.json()["items"][0]["filename"], "from-db.pdf")
        store.list_documents.assert_not_called()

    def test_unindexed_user_backfills_once(self) -> None:
        user_id = uuid4()
        user = SimpleNamespace(id=user_id, email="p@x.co", plan="pro", history_indexed=False)
        rows: list[HistoryDocument] = []

        class FakeDb:
            def get(self, model, pk):
                if model is HistoryDocument:
                    return next((row for row in rows if row.id == pk), None)
                return None

            def add(self, obj):
                if isinstance(obj, HistoryDocument):
                    rows.append(obj)

            def scalars(self, _stmt):
                return SimpleNamespace(all=lambda: list(rows))

        record = DocumentRecord(
            id="legacy",
            filename="scan.png",
            content_type="image/png",
            size_bytes=4,
            source_key="s",
            result_key="r",
            created_at=utc_now_iso(),
            markdown="x",
            owner_id=str(user_id),
        )
        store = MagicMock()
        store.list_documents.return_value = [record]
        app = FastAPI()
        app.include_router(router, prefix="/api")
        app.dependency_overrides[get_principal] = lambda: Principal(
            plan=get_plan("pro"),
            user=user,  # type: ignore[arg-type]
        )
        app.dependency_overrides[get_db] = lambda: FakeDb()
        with patch("app.api.routes.get_document_store", return_value=store):
            client = TestClient(app)
            first = client.get("/api/history")
            second = client.get("/api/history")
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["items"][0]["id"], "legacy")
        self.assertTrue(user.history_indexed)
        self.assertEqual(second.json()["items"][0]["filename"], "scan.png")
        store.list_documents.assert_called_once()

    def test_no_db_falls_back_to_store(self) -> None:
        user_id = uuid4()
        user = SimpleNamespace(id=user_id, email="p@x.co", plan="pro")
        record = DocumentRecord(
            id="doc-s3",
            filename="old.png",
            content_type="image/png",
            size_bytes=1,
            source_key="s",
            result_key="r",
            created_at=utc_now_iso(),
            owner_id=str(user_id),
        )
        store = MagicMock()
        store.list_documents.return_value = [record]
        app = FastAPI()
        app.include_router(router, prefix="/api")
        app.dependency_overrides[get_principal] = lambda: Principal(
            plan=get_plan("pro"),
            user=user,  # type: ignore[arg-type]
        )
        app.dependency_overrides[get_db] = lambda: None
        with patch("app.api.routes.get_document_store", return_value=store):
            res = TestClient(app).get("/api/history")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["items"][0]["id"], "doc-s3")
        store.list_documents.assert_called()
