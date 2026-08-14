"""Invoke the out-of-VPC LLM Lambda so the API Lambda never needs NAT."""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from app.core.config import get_settings
from app.core.logsetup import log_used_engine
from app.services.options import ExtractOptions

logger = logging.getLogger(__name__)


def needs_remote_llm(options: ExtractOptions) -> bool:
    settings = get_settings()
    if not settings.llm_lambda_function:
        return False
    return bool(options.use_ai or options.normalized_target_lang())


def invoke_remote_convert(
    *,
    bucket: str,
    key: str,
    filename: str,
    content_type: str | None,
    output_format: str,
    options: ExtractOptions,
) -> dict[str, Any]:
    settings = get_settings()
    function_name = settings.llm_lambda_function
    if not function_name:
        raise RuntimeError("LLM_LAMBDA_FUNCTION is not set")
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("boto3 is required to invoke the LLM Lambda") from exc

    result_key = f"llm-out/{uuid.uuid4().hex}.json"
    result_bucket = settings.s3_bucket or bucket
    payload = {
        "action": "convert",
        "bucket": bucket,
        "key": key,
        "result_bucket": result_bucket,
        "result_key": result_key,
        "filename": filename,
        "content_type": content_type,
        "output_format": output_format,
        "options": options.to_dict(),
    }
    client = boto3.client(
        "lambda",
        region_name=settings.s3_region,
        config=Config(read_timeout=900, connect_timeout=10, retries={"max_attempts": 0}),
    )
    logger.info("Invoking LLM Lambda %s for %s", function_name, filename)
    response = client.invoke(
        FunctionName=function_name,
        InvocationType="RequestResponse",
        Payload=json.dumps(payload).encode("utf-8"),
    )
    raw = response.get("Payload")
    body = json.loads(raw.read().decode("utf-8") if raw else "{}")
    if response.get("FunctionError"):
        raise RuntimeError(body.get("errorMessage") or body.get("error") or "LLM Lambda failed")
    if not body.get("ok"):
        raise RuntimeError(body.get("error") or "LLM Lambda returned an error")

    import boto3

    s3 = boto3.client("s3", region_name=settings.s3_region)
    out_bucket = body.get("bucket") or result_bucket
    out_key = body.get("key") or result_key
    raw_result = s3.get_object(Bucket=out_bucket, Key=out_key)["Body"].read()
    parsed = json.loads(raw_result.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise RuntimeError("LLM Lambda result was not a JSON object")
    log_used_engine(parsed, filename=filename, logger=logger, via="remote-lambda")
    return parsed
