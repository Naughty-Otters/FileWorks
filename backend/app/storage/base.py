from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Protocol

from pydantic import Field
from pydantic.dataclasses import dataclass


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class DocumentRecord:
    """Persisted document metadata + extraction payload."""

    id: str
    filename: str
    content_type: str | None
    size_bytes: int
    source_key: str
    result_key: str
    created_at: str
    engine: str | None = None
    page_count: int = 0
    output_format: str = "both"
    markdown: str | None = None
    json_data: Any | None = None
    pages: list[dict[str, Any]] = Field(default_factory=list)
    storage_backend: str = "local"
    owner_id: str | None = None

    def summary(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "filename": self.filename,
            "content_type": self.content_type,
            "size_bytes": self.size_bytes,
            "created_at": self.created_at,
            "engine": self.engine,
            "page_count": self.page_count,
            "storage_backend": self.storage_backend,
            "has_markdown": bool(self.markdown and self.markdown.strip()),
            "has_json": self.json_data is not None,
            "owner_id": self.owner_id,
        }

    def to_dict(self) -> dict[str, Any]:
        payload = {name: getattr(self, name) for name in type(self).__pydantic_fields__}
        payload["json"] = payload.pop("json_data")
        return payload

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> DocumentRecord:
        payload = dict(data)
        if "json" in payload and "json_data" not in payload:
            payload["json_data"] = payload.pop("json")
        else:
            payload.pop("json", None)
        known = set(cls.__pydantic_fields__)
        filtered = {k: v for k, v in payload.items() if k in known}
        filtered.setdefault("pages", [])
        filtered.setdefault("page_count", 0)
        filtered.setdefault("output_format", "both")
        filtered.setdefault("storage_backend", "local")
        filtered.setdefault("owner_id", None)
        return cls(**filtered)


class DocumentStore(Protocol):
    """Backend-agnostic document history storage.

    Local filesystem today; swap to S3 by changing STORAGE_BACKEND.
    Keys are logical paths (e.g. ``docs/{id}/source.png``).
    """

    backend_name: str

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
    ) -> DocumentRecord: ...

    def list_documents(self, limit: int = 100) -> list[DocumentRecord]: ...

    def get_document(self, document_id: str) -> DocumentRecord | None: ...

    def get_source_bytes(self, document_id: str) -> tuple[bytes, str, str | None] | None:
        """Return (bytes, filename, content_type) for the original upload."""
        ...

    def delete_document(self, document_id: str) -> bool: ...

    def save_media_files(self, document_id: str, files: list[tuple[str, bytes, str]]) -> None:
        """Write ``docs/{id}/media/n.jpg`` sidecar files. Empty list clears media."""
        ...

    def load_media_files(self, document_id: str) -> dict[str, bytes]:
        """Return ``{filename: bytes}`` for sidecar images."""
        ...
