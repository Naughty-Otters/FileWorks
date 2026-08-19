from __future__ import annotations

import json
import re
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

from app.core.config import get_settings
from app.storage import get_document_store
from app.storage.s3 import S3DocumentStore

_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _safe(value: str) -> str:
    if not _SAFE_ID.fullmatch(value):
        raise ValueError("invalid template storage id")
    return value


class TemplateBlobStore(Protocol):
    backend_name: str

    def save(self, owner_id: str, template_id: str, document: dict[str, Any]) -> None: ...
    def get(self, owner_id: str, template_id: str) -> dict[str, Any] | None: ...
    def delete(self, owner_id: str, template_id: str) -> bool: ...


class LocalTemplateBlobStore:
    backend_name = "local"

    def __init__(self, root: Path) -> None:
        self.root = root / "templates"
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, owner_id: str, template_id: str) -> Path:
        return self.root / _safe(owner_id) / f"{_safe(template_id)}.json"

    def save(self, owner_id: str, template_id: str, document: dict[str, Any]) -> None:
        path = self._path(owner_id, template_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")

    def get(self, owner_id: str, template_id: str) -> dict[str, Any] | None:
        path = self._path(owner_id, template_id)
        if not path.exists():
            return None
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return value if isinstance(value, dict) else None

    def delete(self, owner_id: str, template_id: str) -> bool:
        path = self._path(owner_id, template_id)
        if not path.exists():
            return False
        path.unlink()
        owner_dir = path.parent
        if owner_dir.is_dir() and not any(owner_dir.iterdir()):
            shutil.rmtree(owner_dir)
        return True


class S3TemplateBlobStore:
    backend_name = "s3"

    def __init__(self, document_store: S3DocumentStore) -> None:
        self.store = document_store

    def _key(self, owner_id: str, template_id: str) -> str:
        return f"templates/{_safe(owner_id)}/{_safe(template_id)}/design.json"

    def save(self, owner_id: str, template_id: str, document: dict[str, Any]) -> None:
        self.store.put_json_object(self._key(owner_id, template_id), document)

    def get(self, owner_id: str, template_id: str) -> dict[str, Any] | None:
        return self.store.get_json_object(self._key(owner_id, template_id))

    def delete(self, owner_id: str, template_id: str) -> bool:
        return self.store.delete_object(self._key(owner_id, template_id))


@lru_cache
def get_template_store() -> TemplateBlobStore:
    settings = get_settings()
    document_store = get_document_store()
    if settings.storage_backend.lower().strip() == "s3":
        if not isinstance(document_store, S3DocumentStore):
            raise RuntimeError("S3 template storage requires S3 document storage")
        return S3TemplateBlobStore(document_store)
    return LocalTemplateBlobStore(settings.storage_local_root)
