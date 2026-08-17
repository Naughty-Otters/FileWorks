"""S3-backed document store (STORAGE_BACKEND=s3).

Layout (single app bucket)::

    {prefix}/docs/{id}/meta.json
    {prefix}/docs/{id}/source{suffix}
    {prefix}/docs/{id}/result.json
    {prefix}/docs/{id}/media/n.jpg

Browser uploads (never through Lambda / NAT)::

    s3://{upload_bucket}/upload/files/{user_id}/{document_id}/{filename}

In cloud deploys, history and uploads share one bucket
(`fileworks-<prod|stage|dev>`) with different prefixes. Ephemeral LLM output and
cancel tokens live under `history/llm-out/` and `history/cancel/`.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any
from urllib.parse import quote

from app.storage.base import DocumentRecord, utc_now_iso

logger = logging.getLogger(__name__)

PRESIGN_PUT_EXPIRES = 600
PRESIGN_GET_EXPIRES = 3600
USER_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{8,64}$")
UNSAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
_MEDIA_NAME_RE = re.compile(r"^[0-9]+\.(jpe?g|png|gif|webp)$", re.I)


def sanitize_user_id(user_id: str) -> str:
    value = (user_id or "").strip()
    if not USER_ID_RE.match(value):
        raise ValueError("user_id must be 8–64 characters of letters, digits, _ or -")
    return value


def sanitize_filename(filename: str) -> str:
    name = (filename or "upload.bin").replace("\\", "/").rsplit("/", 1)[-1]
    name = UNSAFE_FILENAME_RE.sub("_", name).strip("._") or "upload.bin"
    return name[:180]


class S3DocumentStore:
    backend_name = "s3"

    def __init__(
        self,
        *,
        bucket: str,
        prefix: str = "fileworks",
        region: str | None = None,
        endpoint_url: str | None = None,
        upload_bucket: str | None = None,
        upload_prefix: str = "upload/files",
    ) -> None:
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.region = region
        self.endpoint_url = endpoint_url
        self.upload_bucket = (upload_bucket or bucket).strip()
        self.upload_prefix = (upload_prefix or "upload/files").strip("/")
        self._client = None

    def _require_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            import boto3
            from botocore.config import Config
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("S3 storage requires boto3. Install with: uv add boto3") from exc
        kwargs: dict[str, Any] = {
            "config": Config(
                signature_version="s3v4",
                s3={"addressing_style": "virtual"},
            )
        }
        if self.region:
            kwargs["region_name"] = self.region
        if self.endpoint_url:
            kwargs["endpoint_url"] = self.endpoint_url
        self._client = boto3.client("s3", **kwargs)
        return self._client

    def _key(self, *parts: str) -> str:
        joined = "/".join(p.strip("/") for p in parts if p)
        return f"{self.prefix}/{joined}" if self.prefix else joined

    def _put_json(self, key: str, payload: Any) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self._require_client().put_object(
            Bucket=self.bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
        )

    def _get_bytes(self, key: str, bucket: str | None = None) -> bytes | None:
        target = bucket or self.bucket
        try:
            resp = self._require_client().get_object(Bucket=target, Key=key)
        except Exception as exc:  # noqa: BLE001
            code = getattr(exc, "response", {}).get("Error", {}).get("Code", "")
            if code in {"NoSuchKey", "404", "NotFound"}:
                return None
            raise
        return resp["Body"].read()

    def _get_json(self, key: str) -> dict[str, Any] | None:
        raw = self._get_bytes(key)
        if raw is None:
            return None
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None
        return data if isinstance(data, dict) else None

    def object_key(self, logical: str) -> str:
        return self._key(logical)

    def _object_bucket(self, key: str) -> str:
        return self.upload_bucket if self.is_upload_key(key) else self.bucket

    def upload_object_key(self, user_id: str, document_id: str, filename: str) -> str:
        uid = sanitize_user_id(user_id)
        safe = sanitize_filename(filename)
        return f"{self.upload_prefix}/{uid}/{document_id}/{safe}"

    def inbox_key(self, document_id: str, suffix: str) -> str:
        ext = suffix if suffix.startswith(".") else f".{suffix}" if suffix else ""
        return self.upload_object_key("anonymous", document_id, f"upload{ext}")

    def is_upload_key(self, key: str) -> bool:
        if not key or ".." in key or key.startswith("/"):
            return False
        upload_root = f"{self.upload_prefix}/"
        inbox_root = self._key("inbox") + "/"
        return key.startswith(upload_root) or key.startswith(inbox_root)

    def is_inbox_key(self, key: str) -> bool:
        return self.is_upload_key(key)

    def put_bytes(self, key: str, data: bytes, content_type: str | None = None) -> None:
        self._require_client().put_object(
            Bucket=self._object_bucket(key),
            Key=key,
            Body=data,
            ContentType=content_type or "application/octet-stream",
        )

    def get_upload_bytes(self, key: str) -> bytes | None:
        """Raw bytes for a presigned-upload key. Uploads live in their own bucket."""
        return self._get_bytes(key, bucket=self._object_bucket(key))


    def presign_put(self, key: str, content_type: str | None) -> tuple[str, dict[str, str]]:
        params: dict[str, str] = {"Bucket": self._object_bucket(key), "Key": key}
        headers: dict[str, str] = {}
        if content_type:
            params["ContentType"] = content_type
            headers["Content-Type"] = content_type
        url = self._require_client().generate_presigned_url(
            "put_object",
            Params=params,
            ExpiresIn=PRESIGN_PUT_EXPIRES,
        )
        return url, headers

    def presign_get(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        disposition: str = "inline",
    ) -> str:
        params: dict[str, str] = {"Bucket": self.bucket, "Key": key}
        if content_type:
            params["ResponseContentType"] = content_type
        if filename:
            fallback = "".join(ch if ch.isascii() and ch not in '"\\/\r\n' else "_" for ch in filename)
            fallback = fallback.strip("._") or "file"
            encoded = quote(filename, safe="")
            params["ResponseContentDisposition"] = (
                f"{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"
            )
        return self._require_client().generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=PRESIGN_GET_EXPIRES,
        )

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
        structure: dict[str, Any] | None = None,
    ) -> DocumentRecord:
        suffix = source_suffix if source_suffix.startswith(".") else f".{source_suffix}"
        source_name = f"source{suffix}"
        source_key = f"docs/{document_id}/{source_name}"
        result_key = f"docs/{document_id}/result.json"
        client = self._require_client()
        client.put_object(
            Bucket=self.bucket,
            Key=self._key(source_key),
            Body=source_bytes,
            ContentType=content_type or "application/octet-stream",
        )
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
            structure=structure,
            storage_backend=self.backend_name,
            owner_id=owner_id,
        )
        self._put_json(self._key("docs", document_id, "meta.json"), record.to_dict())
        self._put_json(
            self._key(result_key),
            {
                "markdown": markdown,
                "json": json_data,
                "pages": pages,
                "structure": structure,
                "engine": engine,
                "page_count": page_count,
                "format": output_format,
            },
        )
        return record

    def list_documents(self, limit: int = 100) -> list[DocumentRecord]:
        client = self._require_client()
        paginator = client.get_paginator("list_objects_v2")
        ids: list[str] = []
        prefix = self._key("docs") + "/"
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix, Delimiter="/"):
            for item in page.get("CommonPrefixes", []):
                raw = str(item.get("Prefix") or "").rstrip("/")
                doc_id = raw.rsplit("/", 1)[-1]
                if doc_id:
                    ids.append(doc_id)
        records: list[DocumentRecord] = []
        for document_id in ids:
            record = self.get_document(document_id)
            if record is not None:
                records.append(record)
        records.sort(key=lambda item: item.created_at, reverse=True)
        return records[:limit]

    def get_document(self, document_id: str) -> DocumentRecord | None:
        data = self._get_json(self._key("docs", document_id, "meta.json"))
        if data is None:
            return None
        try:
            return DocumentRecord.from_dict(data)
        except (TypeError, KeyError) as exc:
            logger.warning("Failed to load document %s: %s", document_id, exc)
            return None

    def get_source_bytes(self, document_id: str) -> tuple[bytes, str, str | None] | None:
        record = self.get_document(document_id)
        if record is None:
            return None
        data = self._get_bytes(self._key(record.source_key))
        if data is None:
            return None
        return data, record.filename, record.content_type

    def delete_document(self, document_id: str) -> bool:
        client = self._require_client()
        prefix = self._key("docs", document_id) + "/"
        keys: list[str] = []
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                key = item.get("Key")
                if key:
                    keys.append(key)
        if not keys:
            return False
        for offset in range(0, len(keys), 1000):
            chunk = keys[offset : offset + 1000]
            client.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": [{"Key": key} for key in chunk], "Quiet": True},
            )
        return True

    def _list_keys(self, prefix: str) -> list[str]:
        client = self._require_client()
        keys: list[str] = []
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                key = item.get("Key")
                if key:
                    keys.append(key)
        return keys

    def save_media_files(self, document_id: str, files: list[tuple[str, bytes, str]]) -> None:
        prefix = self._key("docs", document_id, "media") + "/"
        existing = self._list_keys(prefix)
        client = self._require_client()
        for offset in range(0, len(existing), 1000):
            chunk = existing[offset : offset + 1000]
            if not chunk:
                continue
            client.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": [{"Key": key} for key in chunk], "Quiet": True},
            )
        for name, data, content_type in files:
            if not _MEDIA_NAME_RE.match(name):
                continue
            client.put_object(
                Bucket=self.bucket,
                Key=self._key("docs", document_id, "media", name),
                Body=data,
                ContentType=content_type or "application/octet-stream",
            )

    def load_media_files(self, document_id: str) -> dict[str, bytes]:
        prefix = self._key("docs", document_id, "media") + "/"
        out: dict[str, bytes] = {}
        for key in self._list_keys(prefix):
            name = key.rsplit("/", 1)[-1]
            if not _MEDIA_NAME_RE.match(name):
                continue
            data = self._get_bytes(key)
            if data is not None:
                out[name] = data
        return out
