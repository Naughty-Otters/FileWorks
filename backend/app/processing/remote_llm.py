"""Invoke the out-of-VPC LLM Lambda so the API Lambda never needs NAT.

Stop cannot SIGKILL a running Lambda. The API writes a cancel tombstone; this
module polls it while ``invoke`` blocks, so the API request returns 499 promptly
instead of waiting up to 900s. The Lambda itself exits at its next page check.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from typing import Any

from app.core.config import get_settings
from app.core.logsetup import log_used_engine
from app.services.cancel_token import is_cancelled
from app.services.options import ExtractOptions
from app.services.worker import ConversionCancelled

logger = logging.getLogger(__name__)

_CANCEL_POLL_S = 0.5


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
    run_id: str | None = None,
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

    result_key = f"history/llm-out/{uuid.uuid4().hex}.json"
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
    if run_id:
        payload["run_id"] = run_id
    client = boto3.client(
        "lambda",
        region_name=settings.s3_region,
        config=Config(read_timeout=900, connect_timeout=10, retries={"max_attempts": 0}),
    )
    logger.info(
        "Invoking LLM Lambda %s for %s (run_id=%s)",
        function_name,
        filename,
        run_id or "-",
    )

    response = _invoke_until_done_or_cancelled(
        client,
        function_name=function_name,
        payload=payload,
        run_id=run_id,
        filename=filename,
    )
    raw = response.get("Payload")
    body = json.loads(raw.read().decode("utf-8") if raw else "{}")
    if response.get("FunctionError"):
        raise RuntimeError(body.get("errorMessage") or body.get("error") or "LLM Lambda failed")
    if body.get("cancelled"):
        raise ConversionCancelled(body.get("error") or "Conversion stopped by the client")
    if not body.get("ok"):
        raise RuntimeError(body.get("error") or "LLM Lambda returned an error")

    s3 = boto3.client("s3", region_name=settings.s3_region)
    out_bucket = body.get("bucket") or result_bucket
    out_key = body.get("key") or result_key
    raw_result = s3.get_object(Bucket=out_bucket, Key=out_key)["Body"].read()
    parsed = json.loads(raw_result.decode("utf-8"))
    if not isinstance(parsed, dict):
        raise RuntimeError("LLM Lambda result was not a JSON object")
    log_used_engine(parsed, filename=filename, logger=logger, via="remote-lambda")
    return parsed


def _invoke_until_done_or_cancelled(
    client: Any,
    *,
    function_name: str,
    payload: dict[str, Any],
    run_id: str | None,
    filename: str,
) -> dict[str, Any]:
    """Block on ``invoke``, but raise promptly when the cancel tombstone appears.

    boto3 cannot abort an in-flight RequestResponse call. We still return 499 to
    the client as soon as Stop is recorded; the Lambda exits at its next page check.
    """
    box: dict[str, Any] = {}

    def _call() -> None:
        try:
            box["response"] = client.invoke(
                FunctionName=function_name,
                InvocationType="RequestResponse",
                Payload=json.dumps(payload).encode("utf-8"),
            )
        except Exception as exc:  # noqa: BLE001
            box["error"] = exc

    thread = threading.Thread(target=_call, name=f"llm-invoke-{run_id or 'anon'}", daemon=True)
    thread.start()
    while thread.is_alive():
        thread.join(timeout=_CANCEL_POLL_S)
        if run_id and is_cancelled(run_id):
            logger.warning(
                "Stop seen while waiting on LLM Lambda for %s (run_id=%s) — "
                "returning cancelled; Lambda will exit at its next page check",
                filename,
                run_id,
            )
            raise ConversionCancelled(
                "Conversion stopped by the client (remote Lambda will finish the current page)"
            )
    if "error" in box:
        raise box["error"]
    return box["response"]
