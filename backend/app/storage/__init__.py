from __future__ import annotations

from functools import lru_cache

from app.core.config import get_settings
from app.storage.base import DocumentStore
from app.storage.local import LocalDocumentStore
from app.storage.s3 import S3DocumentStore


@lru_cache
def get_document_store() -> DocumentStore:
    settings = get_settings()
    backend = settings.storage_backend.lower().strip()

    if backend == "local":
        root = settings.storage_local_root
        root.mkdir(parents=True, exist_ok=True)
        return LocalDocumentStore(root)

    if backend == "s3":
        if not settings.s3_bucket:
            raise RuntimeError("STORAGE_BACKEND=s3 requires S3_BUCKET")
        return S3DocumentStore(
            bucket=settings.s3_bucket,
            prefix=settings.s3_prefix,
            region=settings.s3_region,
            endpoint_url=settings.s3_endpoint_url,
            upload_bucket=settings.s3_upload_bucket or settings.s3_bucket,
            upload_prefix=settings.s3_upload_prefix,
        )

    raise RuntimeError(f"Unsupported STORAGE_BACKEND={settings.storage_backend!r}")
