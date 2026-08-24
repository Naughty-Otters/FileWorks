"""Postgres index of workspace history. Blobs stay in S3 / local storage."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import HistoryDocument, User
from app.storage.base import DocumentRecord

logger = logging.getLogger(__name__)


def _db_ready(db: Session | None) -> bool:
    return db is not None and callable(getattr(db, "get", None)) and callable(getattr(db, "add", None))


def _parse_created(value: str | None) -> datetime:
    raw = (value or "").strip()
    if raw:
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                return parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _as_user_id(value: object) -> UUID | None:
    if value is None:
        return None
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except ValueError:
        return None


def upsert_history_summary(db: Session | None, record: DocumentRecord) -> None:
    if not _db_ready(db):
        return
    user_id = _as_user_id(record.owner_id)
    if user_id is None or not record.id:
        return
    row = db.get(HistoryDocument, record.id)
    if row is None:
        row = HistoryDocument(id=record.id, user_id=user_id)
        db.add(row)
    elif row.user_id != user_id:
        return
    row.filename = (record.filename or "document")[:255]
    row.content_type = record.content_type
    row.size_bytes = int(record.size_bytes or 0)
    row.engine = record.engine
    row.page_count = int(record.page_count or 0)
    row.storage_backend = record.storage_backend or "s3"
    row.has_markdown = bool(record.markdown and str(record.markdown).strip())
    row.has_json = record.json_data is not None
    row.has_design = bool(getattr(record, "has_design", False))
    row.design_template_id = getattr(record, "design_template_id", None)
    row.design_template_name = getattr(record, "design_template_name", None)
    row.created_at = _parse_created(record.created_at)


def delete_history_summary(db: Session | None, *, user_id: UUID | None, document_id: str) -> None:
    if not _db_ready(db) or user_id is None or not callable(getattr(db, "delete", None)):
        return
    row = db.get(HistoryDocument, document_id)
    if row is None or row.user_id != user_id:
        return
    db.delete(row)


def live_document_ids(store: object) -> set[str] | None:
    """Ids that still have blobs. ``None`` means the store could not be listed."""
    lister = getattr(store, "list_document_ids", None)
    if not callable(lister):
        return None
    try:
        ids = lister()
    except Exception:  # noqa: BLE001
        logger.exception("Failed to list stored document ids")
        return None
    if not isinstance(ids, (set, list, tuple)):
        return None
    return {str(item) for item in ids}


def prune_missing_summaries(
    db: Session | None,
    *,
    user_id: UUID | None,
    items: list[dict],
    live_ids: set[str],
) -> list[dict]:
    """Drop Postgres index rows whose S3/local blobs are gone.

    The history list is a Postgres index; blobs live in the document store.
    After the history bucket was folded into the app bucket, leftover index
    rows pointed at objects that were never copied and could not be opened
    or deleted.
    """
    kept: list[dict] = []
    for item in items:
        doc_id = str(item.get("id") or "")
        if doc_id and doc_id in live_ids:
            kept.append(item)
        elif doc_id:
            delete_history_summary(db, user_id=user_id, document_id=doc_id)
    return kept


def list_history_summaries(
    db: Session | None,
    *,
    user_id: UUID | None,
    limit: int,
) -> list[dict] | None:
    """Return summaries, or None when Postgres is not in use."""
    if not _db_ready(db) or user_id is None:
        return None
    try:
        rows = list(
            db.scalars(
                select(HistoryDocument)
                .where(HistoryDocument.user_id == user_id)
                .order_by(HistoryDocument.created_at.desc())
                .limit(limit)
            ).all()
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed to list history summaries")
        return None
    if any(not isinstance(row, HistoryDocument) for row in rows):
        return None
    return [_summary_payload(row) for row in rows]


def backfill_history_index(
    db: Session | None,
    *,
    user: User | None,
    records: list[DocumentRecord],
) -> None:
    if not _db_ready(db) or user is None or getattr(user, "history_indexed", True):
        return
    owner = str(user.id)
    for record in records:
        if record.owner_id != owner:
            continue
        upsert_history_summary(db, record)
    user.history_indexed = True
    db.add(user)


def _summary_payload(row: HistoryDocument) -> dict:
    created = row.created_at.isoformat() if row.created_at else ""
    return {
        "id": row.id,
        "filename": row.filename,
        "content_type": row.content_type,
        "size_bytes": row.size_bytes,
        "created_at": created,
        "engine": row.engine,
        "page_count": row.page_count,
        "storage_backend": row.storage_backend,
        "has_markdown": row.has_markdown,
        "has_json": row.has_json,
        "has_design": bool(getattr(row, "has_design", False)),
        "design_template_id": getattr(row, "design_template_id", None),
        "design_template_name": getattr(row, "design_template_name", None),
        "owner_id": str(row.user_id),
    }
