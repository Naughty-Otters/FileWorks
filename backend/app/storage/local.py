from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any

from app.storage.base import DocumentRecord, utc_now_iso

logger = logging.getLogger(__name__)


class LocalDocumentStore:
    """Filesystem-backed document history.

    Layout::

        {root}/
          index.json
          docs/{id}/
            meta.json
            source{suffix}
            result.json
    """

    backend_name = "local"

    def __init__(self, root: Path) -> None:
        self.root = root
        self.docs_dir = root / "docs"
        self.index_path = root / "index.json"
        self.docs_dir.mkdir(parents=True, exist_ok=True)
        if not self.index_path.exists():
            self._write_index([])

    def _doc_dir(self, document_id: str) -> Path:
        return self.docs_dir / document_id

    def _write_index(self, ids: list[str]) -> None:
        self.index_path.write_text(json.dumps(ids, indent=2), encoding="utf-8")

    def _read_index(self) -> list[str]:
        try:
            data = json.loads(self.index_path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                return [str(item) for item in data]
        except (OSError, json.JSONDecodeError):
            logger.warning("Corrupt or missing history index; rebuilding")
        # Rebuild from disk
        ids = sorted(
            (p.name for p in self.docs_dir.iterdir() if p.is_dir()),
            reverse=True,
        )
        self._write_index(ids)
        return ids

    def _prepend_index(self, document_id: str) -> None:
        ids = [document_id] + [i for i in self._read_index() if i != document_id]
        self._write_index(ids)

    def _remove_from_index(self, document_id: str) -> None:
        ids = [i for i in self._read_index() if i != document_id]
        self._write_index(ids)

    def save_document(
        self,
        *,
        document_id: str,
        filename: str,
        content_type: str | None,
        source_bytes: bytes,
        source_suffix: str,
        engine: str | None,
        page_count: int,
        output_format: str,
        markdown: str | None,
        json_data: Any | None,
        pages: list[dict[str, Any]],
        owner_id: str | None = None,
    ) -> DocumentRecord:
        suffix = source_suffix if source_suffix.startswith(".") else f".{source_suffix}"
        source_name = f"source{suffix}"
        source_key = f"docs/{document_id}/{source_name}"
        result_key = f"docs/{document_id}/result.json"

        doc_dir = self._doc_dir(document_id)
        doc_dir.mkdir(parents=True, exist_ok=True)

        source_path = doc_dir / source_name
        source_path.write_bytes(source_bytes)

        record = DocumentRecord(
            id=document_id,
            filename=filename,
            content_type=content_type,
            size_bytes=len(source_bytes),
            source_key=source_key,
            result_key=result_key,
            created_at=utc_now_iso(),
            engine=engine,
            page_count=page_count,
            output_format=output_format,
            markdown=markdown,
            json_data=json_data,
            pages=pages,
            storage_backend=self.backend_name,
            owner_id=owner_id,
        )

        meta_path = doc_dir / "meta.json"
        result_path = doc_dir / "result.json"
        meta_path.write_text(json.dumps(record.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        result_path.write_text(
            json.dumps(
                {
                    "markdown": markdown,
                    "json": json_data,
                    "pages": pages,
                    "engine": engine,
                    "page_count": page_count,
                    "format": output_format,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        self._prepend_index(document_id)
        return record

    def list_documents(self, limit: int = 100) -> list[DocumentRecord]:
        records: list[DocumentRecord] = []
        for document_id in self._read_index():
            record = self.get_document(document_id)
            if record is not None:
                records.append(record)
            if len(records) >= limit:
                break
        return records

    def get_document(self, document_id: str) -> DocumentRecord | None:
        meta_path = self._doc_dir(document_id) / "meta.json"
        if not meta_path.exists():
            return None
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
            return DocumentRecord.from_dict(data)
        except (OSError, json.JSONDecodeError, TypeError, KeyError) as exc:
            logger.warning("Failed to load document %s: %s", document_id, exc)
            return None

    def get_source_bytes(self, document_id: str) -> tuple[bytes, str, str | None] | None:
        record = self.get_document(document_id)
        if record is None:
            return None
        source_path = self.root / record.source_key
        if not source_path.exists():
            # Fallback: find source* in doc dir
            doc_dir = self._doc_dir(document_id)
            matches = list(doc_dir.glob("source.*")) + list(doc_dir.glob("source"))
            if not matches:
                return None
            source_path = matches[0]
        return source_path.read_bytes(), record.filename, record.content_type

    def delete_document(self, document_id: str) -> bool:
        doc_dir = self._doc_dir(document_id)
        if not doc_dir.exists():
            self._remove_from_index(document_id)
            return False
        shutil.rmtree(doc_dir, ignore_errors=True)
        self._remove_from_index(document_id)
        return True
