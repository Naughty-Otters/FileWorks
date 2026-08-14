"""Out-of-VPC Lambda handler: vision LLM + translation (public HTTPS)."""

from __future__ import annotations

import json
import logging
import tempfile
from pathlib import Path
from typing import Any

from app.core.logsetup import configure_app_logging

configure_app_logging()
logger = logging.getLogger(__name__)


def handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    try:
        return _run(event)
    except Exception as exc:  # noqa: BLE001
        logger.exception("LLM worker failed")
        return {"ok": False, "error": str(exc)}


def _run(event: dict[str, Any]) -> dict[str, Any]:
    from app.core.config import get_settings
    from app.services.convert import convert_document
    from app.services.options import ExtractOptions

    action = event.get("action") or "convert"
    if action != "convert":
        raise ValueError(f"Unsupported action: {action}")

    bucket = str(event["bucket"])
    key = str(event["key"])
    filename = str(event.get("filename") or Path(key).name)
    content_type = event.get("content_type")
    output_format = event.get("output_format") or "both"
    options = ExtractOptions.from_form(**(event.get("options") or {}))
    result_bucket = str(event.get("result_bucket") or bucket)
    result_key = str(event["result_key"])

    import boto3

    settings = get_settings()
    s3 = boto3.client("s3", region_name=settings.s3_region)
    obj = s3.get_object(Bucket=bucket, Key=key)
    data = obj["Body"].read()
    suffix = Path(filename).suffix or ".bin"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(data)
        tmp.flush()
        result = convert_document(
            Path(tmp.name),
            output_format=output_format,
            options=options,
            mime_type=content_type,
            filename=filename,
        )
    body = json.dumps(result, ensure_ascii=False, default=str).encode("utf-8")
    s3.put_object(
        Bucket=result_bucket,
        Key=result_key,
        Body=body,
        ContentType="application/json",
    )
    return {"ok": True, "bucket": result_bucket, "key": result_key}
