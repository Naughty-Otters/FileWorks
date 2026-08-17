from __future__ import annotations

import logging
import uuid
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import RedirectResponse, Response
from starlette.concurrency import run_in_threadpool

from app.api.schemas import (
    CancelRunResponse,
    EngineInfo,
    ExportRequest,
    ExtractOptionsResponse,
    ExtractResponse,
    HealthResponse,
    HistoryDetailResponse,
    HistoryFileUrlResponse,
    HistoryItem,
    HistoryListResponse,
    ImageSize,
    LLMFileProvider,
    PresignUploadRequest,
    PresignUploadResponse,
    RegionBox,
    TranslateLanguage,
)
from app.auth.deps import Principal, get_principal
from app.auth.quota import assert_can_extract, assert_can_use_ai, record_extract
from app.auth.redact import redact_extract_payload, redact_structure_payload
from app.core.config import get_settings
from app.core.logsetup import emit
from app.engines.llm.catalog import list_vision_providers
from app.processing.postprocess.media import expand_embedded_media, fold_embedded_media
from app.processing.pipeline import get_document_pipeline
from app.processing.postprocess import get_markdown_translator, language_catalog
from app.processing.reading.anydoc import anydoc_is_available
from app.processing.remote_llm import invoke_remote_convert, needs_remote_llm
from app.services.export import export_markdown
from app.services.ocr import get_ocr_service
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions
from app.services.regions import extract_regions
from app.services.runtime import (
    ANONYMOUS_OWNER,
    ConversionBusy,
    ConversionCancelled,
    cancel_run,
    get_conversion_gate,
    run_conversion,
)
from app.storage import get_document_store
from app.storage.s3 import S3DocumentStore, PRESIGN_GET_EXPIRES, PRESIGN_PUT_EXPIRES
from app.db.history import (
    backfill_history_index,
    delete_history_summary,
    list_history_summaries,
    upsert_history_summary,
)
from app.db.session import get_db
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

router = APIRouter()


def content_disposition(disposition: str, filename: str) -> str:
    """RFC 6266 header that stays latin-1 safe for Starlette."""
    fallback = "".join(ch if ch.isascii() and ch not in '"\\/\r\n' else "_" for ch in filename)
    fallback = fallback.strip("._") or "file"
    encoded = quote(filename, safe="")
    return f"{disposition}; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


ALLOWED_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".bmp",
    ".tif",
    ".tiff",
    ".webp",
    ".pdf",
    ".doc",
    ".docx",
    ".docm",
    ".ppt",
    ".pps",
    ".pot",
    ".pptx",
    ".pptm",
    ".ppsx",
    ".ppsm",
    ".xls",
    ".xlsx",
    ".xlsm",
    ".xlsb",
    ".odt",
    ".ods",
    ".odp",
    ".rtf",
    ".epub",
    ".csv",
    ".txt",
    ".md",
    ".markdown",
}
ALLOWED_CONTENT_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/bmp",
    "image/tiff",
    "image/webp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    "application/rtf",
    "text/rtf",
    "application/epub+zip",
    "text/csv",
    "application/csv",
    "text/plain",
    "text/markdown",
    "text/x-markdown",
    "application/octet-stream",
}


def _s3_store() -> S3DocumentStore | None:
    store = get_document_store()
    return store if isinstance(store, S3DocumentStore) else None


def _validate_filename(original: str) -> str:
    suffix = Path(original).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )
    return suffix


def _validate_upload_bytes(original: str, data: bytes, content_type: str | None) -> tuple[str, str]:
    """Return (original_filename, suffix)."""
    settings = get_settings()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {settings.max_upload_mb}MB",
        )
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    suffix = _validate_filename(original)
    ctype = (content_type or "").lower()
    if ctype and ctype not in ALLOWED_CONTENT_TYPES:
        logger.warning("Unusual content type %s for %s", ctype, original)
    return original, suffix


def _validate_upload(file: UploadFile, data: bytes) -> tuple[str, str]:
    return _validate_upload_bytes(file.filename or "upload.bin", data, file.content_type)


def _run_owner(principal: Principal) -> str:
    """Cancel scope: a signed-in user, else the anonymous browser id."""
    if principal.user_id:
        return f"user:{principal.user_id}"
    return f"anon:{principal.anonymous_id or ANONYMOUS_OWNER}"


def _health_payload(
    *,
    status: str,
    settings,
    service,
    ocr_ready: bool | None = None,
    ocr_error: str | None = None,
) -> HealthResponse:
    pipeline = get_document_pipeline()
    gate = get_conversion_gate()
    reading = []
    for item in pipeline.list_readers():
        engine_id = str(item.get("id"))
        configured = True
        error = None
        ready = True
        if engine_id == "anydoc":
            ready = anydoc_is_available()
            configured = ready
            error = None if ready else "firecrawl-anydoc not installed"
        elif engine_id == "ocr":
            # Ready if either Paddle provider can load (or already loaded).
            ready = False
            errors: list[str] = []
            for provider_id in ("ocr", "structure"):
                try:
                    provider = service.registry.get(provider_id)
                    if provider.ready:
                        ready = True
                        break
                    if provider.init_error:
                        errors.append(f"{provider_id}: {provider.init_error}")
                except Exception as exc:  # noqa: BLE001
                    errors.append(f"{provider_id}: {exc}")
            if not ready and errors:
                error = "; ".join(errors)
        elif engine_id == "llm":
            configured = bool(item.get("configured"))
            vision = bool(item.get("supports_vision"))
            ready = configured and vision
            error = str(item.get("error") or item.get("vision_error") or "") or None
        reading.append(
            EngineInfo(
                id=engine_id,
                label=str(item.get("label")),
                ready=ready,
                configured=configured,
                active=False,
                error=error,
                option_support={},
            )
        )
    # OCR providers (server-selected backend strategies)
    ocr_engines = [EngineInfo(**item) for item in service.list_engines()]
    llm_item = next((item for item in reading if item.id == "llm"), None)
    file_providers = [
        LLMFileProvider(
            id=spec.id,
            label=spec.label,
            default_model=spec.default_model,
            native_pdf=spec.native_pdf,
            key_env=spec.key_fields[0].upper() if spec.key_fields else "LLM_API_KEY",
        )
        for spec in list_vision_providers()
    ]
    translator = get_markdown_translator()
    translate_info = translator.describe()
    llm_ready = bool(llm_item.ready) if llm_item else False
    llm_error = llm_item.error if llm_item else None
    llm_provider = str(llm_item.label) if llm_item and llm_item.configured else None
    translate_ready = bool(translate_info.get("ready"))
    translate_error = str(translate_info.get("error") or "") or None
    if settings.llm_lambda_function:
        llm_ready = True
        llm_error = None
        llm_provider = llm_provider or "remote-lambda"
        if not translate_ready:
            translate_ready = True
            translate_error = None
    return HealthResponse(
        status=status,
        app=settings.app_name,
        ocr_ready=service.ready if ocr_ready is None else ocr_ready,
        ocr_engine=service.mode,
        ocr_error=ocr_error if ocr_error is not None else service.init_error,
        llm_ready=llm_ready,
        llm_provider=llm_provider,
        llm_error=llm_error,
        llm_file_providers=file_providers,
        translate_ready=translate_ready,
        translate_provider=str(translate_info["label"]) if translate_info.get("configured") else (
            "remote-lambda" if settings.llm_lambda_function else None
        ),
        translate_error=translate_error,
        translate_languages=[TranslateLanguage(**item) for item in language_catalog()],
        storage_backend=settings.storage_backend,
        direct_upload=settings.storage_backend.lower() == "s3",
        engines=[*reading, *ocr_engines],
        converting=gate.running,
        convert_waiting=gate.waiting,
        convert_capacity=gate.limit,
    )


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    settings = get_settings()
    service = get_ocr_service()
    return _health_payload(status="ok", settings=settings, service=service)


@router.get("/engines", response_model=list[EngineInfo])
async def list_engines() -> list[EngineInfo]:
    """List registered OCR engine strategies."""
    service = get_ocr_service()
    return [EngineInfo(**item) for item in service.list_engines()]


@router.post("/warmup", response_model=HealthResponse)
async def warmup() -> HealthResponse:
    """Eagerly load the server-configured OCR engine (downloads models on first call)."""
    settings = get_settings()
    service = get_ocr_service()
    try:
        service.ensure_loaded()
    except Exception as exc:  # noqa: BLE001
        return _health_payload(
            status="degraded",
            settings=settings,
            service=service,
            ocr_ready=False,
            ocr_error=str(exc),
        )
    return _health_payload(status="ok", settings=settings, service=service, ocr_ready=True, ocr_error=None)


@router.get("/options", response_model=ExtractOptionsResponse)
async def get_extract_options() -> ExtractOptionsResponse:
    """Default document parsing toggles for the UI."""
    return ExtractOptionsResponse(**DEFAULT_EXTRACT_OPTIONS.to_dict())


def _form_bool(value: bool | str) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _regions_payload(json_data: Any, pages: list | None = None) -> tuple[list[RegionBox], ImageSize | None]:
    regions_raw, size_raw = extract_regions(json_data)
    if not regions_raw and pages:
        for page in pages:
            if not isinstance(page, dict):
                continue
            page_regions, page_size = extract_regions(page.get("json") or page, page=int(page.get("page") or 1))
            regions_raw.extend(page_regions)
            if size_raw is None and page_size is not None:
                size_raw = page_size
    regions = [RegionBox(**item) for item in regions_raw]
    image_size = ImageSize(**size_raw) if size_raw else None
    return regions, image_size


@router.post("/uploads/presign", response_model=PresignUploadResponse)
async def presign_upload(
    body: PresignUploadRequest,
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> PresignUploadResponse:
    """Browser PUT to S3 — file bytes never transit Lambda (avoids NAT + 6MB cap)."""
    assert_can_extract(db, user_id=principal.user_id, plan=principal.plan)
    store = _s3_store()
    if store is None:
        raise HTTPException(status_code=501, detail="Direct S3 upload is not enabled")
    settings = get_settings()
    if body.size_bytes is not None and body.size_bytes > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {settings.max_upload_mb}MB",
        )
    original = body.filename or "upload.bin"
    _validate_filename(original)
    document_id = uuid.uuid4().hex
    try:
        key = store.upload_object_key(body.user_id, document_id, original)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    url, headers = store.presign_put(key, body.content_type)
    return PresignUploadResponse(
        upload_url=url,
        object_key=key,
        bucket=store.upload_bucket,
        headers=headers,
        expires_in=PRESIGN_PUT_EXPIRES,
    )


@router.post("/extract/cancel", response_model=CancelRunResponse)
async def cancel_extract(
    run_id: str = Form(..., description="The run_id sent with POST /extract"),
    principal: Principal = Depends(get_principal),
) -> CancelRunResponse:
    """Stop a run started by this client.

    Local conversions: kill the child process. Lambda conversions: write a
    cancel tombstone the worker checks between pages (AWS cannot SIGKILL a
    running invocation).
    """
    owner = _run_owner(principal)
    logger.info("Stop requested for run=%s by owner=%s", run_id, owner)

    def _stop() -> tuple[bool, bool]:
        from app.services.cancel_token import mark_cancelled

        local = cancel_run(run_id, owner=owner)
        # Always write the tombstone so a remote LLM Lambda (or a late page loop)
        # sees the Stop even when this process has no matching RunHandle.
        remote = mark_cancelled(run_id, owner=owner, reason="stopped by the client")
        return local, remote

    local_stopped, token_written = await run_in_threadpool(_stop)
    stopped = local_stopped or token_written
    gate = get_conversion_gate()
    logger.info(
        "Stop result run=%s stopped=%s killed=%s token=%s (running=%s/%s, waiting=%s)",
        run_id,
        stopped,
        local_stopped,
        token_written,
        gate.running,
        gate.limit,
        gate.waiting,
    )
    if local_stopped and token_written:
        detail = "Conversion stopped (process killed and cancel token written)"
    elif local_stopped:
        detail = "Conversion stopped (process killed)"
    elif token_written:
        detail = "Conversion stop signalled (cancel token written; work exits at next page check)"
    else:
        detail = "No matching run is active"
    return CancelRunResponse(
        run_id=run_id,
        stopped=stopped,
        killed=local_stopped,
        token_written=token_written,
        detail=detail,
    )


@router.post("/extract", response_model=ExtractResponse)
async def extract(
    request: Request,
    file: UploadFile | None = File(default=None, description="Image or PDF to extract"),
    s3_key: str | None = Form(default=None, description="Object key from /uploads/presign"),
    filename: str | None = Form(default=None),
    content_type: str | None = Form(default=None),
    output_format: Literal["markdown", "json", "both"] = Form(
        default="both",
        description="Desired output format",
    ),
    use_ai: bool = Form(default=False),
    prefer_structure: bool = Form(default=False),
    use_doc_preprocessor: bool = Form(default=False),
    use_seal_recognition: bool = Form(default=False),
    use_table_recognition: bool = Form(default=True),
    use_formula_recognition: bool = Form(default=False),
    use_chart_recognition: bool = Form(default=False),
    use_region_detection: bool = Form(default=True),
    format_block_content: bool = Form(default=True),
    target_lang: str = Form(default=""),
    run_id: str | None = Form(
        default=None,
        description="Client-generated id so POST /extract/cancel can stop this run",
    ),
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> ExtractResponse:
    settings = get_settings()
    assert_can_extract(db, user_id=principal.user_id, plan=principal.plan)
    mime_type = content_type
    if s3_key:
        store = _s3_store()
        if store is None:
            raise HTTPException(status_code=400, detail="s3_key requires STORAGE_BACKEND=s3")
        if not store.is_upload_key(s3_key):
            raise HTTPException(status_code=400, detail="Invalid upload key")
        data = store.get_upload_bytes(s3_key)
        if data is None:
            raise HTTPException(status_code=400, detail="Uploaded object not found — retry the upload")
        original_name = filename or Path(s3_key).name
        original_name, suffix = _validate_upload_bytes(original_name, data, content_type)
        mime_type = content_type
    elif file is not None:
        data = await file.read()
        original_name, suffix = _validate_upload(file, data)
        mime_type = file.content_type
    else:
        raise HTTPException(status_code=400, detail="Provide a file upload or s3_key")
    document_id = uuid.uuid4().hex
    temp_path = settings.upload_dir / f"{document_id}{suffix}"
    options = ExtractOptions.from_form(
        use_ai=_form_bool(use_ai),
        prefer_structure=_form_bool(prefer_structure),
        use_doc_preprocessor=_form_bool(use_doc_preprocessor),
        use_seal_recognition=_form_bool(use_seal_recognition),
        use_table_recognition=_form_bool(use_table_recognition),
        use_formula_recognition=_form_bool(use_formula_recognition),
        use_chart_recognition=_form_bool(use_chart_recognition),
        use_region_detection=_form_bool(use_region_detection),
        format_block_content=_form_bool(format_block_content),
        target_lang=str(target_lang or ""),
    )
    emit(
        f"Extract file={original_name} prefer_structure={options.prefer_structure is True} "
        f"use_ai={options.use_ai is True}",
        logger=logger,
    )
    assert_can_use_ai(
        db,
        user_id=principal.user_id,
        plan=principal.plan,
        use_ai=options.use_ai,
        translate=bool(options.normalized_target_lang()),
    )
    if options.normalized_target_lang():
        if not settings.llm_lambda_function:
            translator = get_markdown_translator()
            if not translator.configured():
                raise HTTPException(
                    status_code=400,
                    detail=translator.init_error or "Translation is not configured",
                )

    try:
        temp_path.write_bytes(data)
        try:
            if needs_remote_llm(options):
                store = _s3_store()
                if store is None:
                    raise HTTPException(
                        status_code=503,
                        detail="AI reading and translation require S3 on this deployment",
                    )
                if s3_key:
                    remote_key = s3_key
                    remote_bucket = store.upload_bucket if store.is_upload_key(s3_key) else store.bucket
                else:
                    owner = str(principal.user_id) if principal.user_id else (
                        principal.anonymous_id or "anonymous"
                    )
                    try:
                        remote_key = store.upload_object_key(owner, document_id, original_name)
                    except ValueError:
                        remote_key = store.upload_object_key("anonymous", document_id, original_name)
                    store.put_bytes(remote_key, data, mime_type)
                    remote_bucket = store.upload_bucket
                # Network-bound, but still blocking: keep it off the event loop.
                # Pass run_id so the LLM Lambda can honour Stop via the cancel tombstone.
                remote_run_id = str(run_id or "").strip() or None
                result = await run_in_threadpool(
                    lambda: invoke_remote_convert(
                        bucket=remote_bucket,
                        key=remote_key,
                        filename=original_name,
                        content_type=mime_type,
                        output_format=output_format,
                        options=options,
                        run_id=remote_run_id,
                    )
                )
            else:
                result = await run_conversion(
                    temp_path,
                    output_format=output_format,
                    options=options,
                    mime_type=mime_type,
                    filename=original_name,
                    request=request,
                    run_id=str(run_id or "").strip() or None,
                    owner=_run_owner(principal),
                )
        except HTTPException:
            raise
        except ConversionCancelled as exc:
            # Nobody is listening; the status is for the log, not the client.
            raise HTTPException(status_code=499, detail=str(exc)) from exc
        except ConversionBusy as exc:
            raise HTTPException(
                status_code=503,
                detail=str(exc),
                headers={"Retry-After": "15"},
            ) from exc
        except Exception as exc:  # noqa: BLE001
            logger.exception("Document conversion failed")
            raise HTTPException(status_code=500, detail=f"Conversion failed: {exc}") from exc

        markdown = result.get("markdown")
        json_data = result.get("json")
        pages = result.get("pages") or []
        structure = result.get("structure")
        if not principal.plan.full_result:
            markdown, json_data, pages = redact_extract_payload(markdown, json_data, pages)
            if isinstance(structure, dict) and isinstance(structure.get("blocks"), list):
                structure = redact_structure_payload(structure)

        record = None
        if principal.plan.history:
            store = get_document_store()
            folded = fold_embedded_media(
                result.get("markdown"),
                result.get("json"),
                result.get("pages") or [],
            )
            try:
                record = store.save_document(
                    document_id=document_id,
                    filename=original_name,
                    content_type=mime_type,
                    source_bytes=data,
                    source_suffix=suffix,
                    engine=result.get("engine", "unknown"),
                    page_count=int(result.get("page_count", 0)),
                    output_format=output_format,
                    markdown=folded.markdown,
                    json_data=folded.json_data,
                    pages=folded.pages,
                    owner_id=str(principal.user_id) if principal.user_id else None,
                    structure=structure if isinstance(structure, dict) else None,
                )
                store.save_media_files(
                    document_id,
                    [(item.name, item.data, item.content_type) for item in folded.files],
                )
                upsert_history_summary(db, record)
            except Exception as exc:  # noqa: BLE001
                logger.exception("Failed to persist document history")
                raise HTTPException(status_code=500, detail=f"Failed to save history: {exc}") from exc

        record_extract(
            db,
            user_id=principal.user_id,
            anonymous_id=principal.anonymous_id,
            enhanced=options.use_ai or bool(options.normalized_target_lang()),
        )

        regions_raw = result.get("regions") or []
        image_size_raw = result.get("image_size")
        if not regions_raw:
            regions, image_size = _regions_payload(json_data, pages)
        else:
            regions = [RegionBox(**item) for item in regions_raw]
            image_size = ImageSize(**image_size_raw) if image_size_raw else None

        return ExtractResponse(
            id=record.id if record else document_id,
            filename=original_name,
            content_type=mime_type,
            size_bytes=len(data),
            engine=(record.engine if record else result.get("engine")) or "unknown",
            page_count=int(result.get("page_count", 0)),
            format=output_format,
            markdown=markdown,
            data=json_data,
            pages=pages,
            created_at=record.created_at if record else None,
            storage_backend=record.storage_backend if record else None,
            options=ExtractOptionsResponse(**options.to_dict()),
            regions=regions,
            image_size=image_size,
            structure=structure if isinstance(structure, dict) else None,
        )
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                logger.warning("Failed to clean up temp upload %s", temp_path)


@router.post("/export")
async def export_document(
    body: ExportRequest,
    principal: Principal = Depends(get_principal),
) -> Response:
    """Download Markdown / structure as markdown / txt / html / json / docx."""
    if not principal.plan.export:
        raise HTTPException(status_code=403, detail={"code": "plan_forbidden", "feature": "export"})
    structure = body.structure
    markdown = body.markdown
    if body.document_id and structure is None:
        store = get_document_store()
        record = store.get_document(body.document_id)
        if record is not None and isinstance(record.structure, dict):
            structure = record.structure
            if not (markdown or "").strip() and record.markdown:
                markdown = record.markdown
    try:
        data, media_type, ext = export_markdown(
            markdown,
            fmt=body.format,
            title=(body.filename or "document").rsplit(".", 1)[0],
            structure=structure,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    base = (body.filename or "document").rsplit(".", 1)[0] or "document"
    headers = {"Content-Disposition": content_disposition("attachment", f"{base}.{ext}")}
    return Response(content=data, media_type=media_type, headers=headers)


@router.get("/history", response_model=HistoryListResponse)
async def list_history(
    limit: int = 100,
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> HistoryListResponse:
    settings = get_settings()
    if not principal.plan.history or not principal.user_id:
        return HistoryListResponse(items=[], storage_backend=settings.storage_backend)
    limit = max(1, min(limit, 500))
    items = list_history_summaries(db, user_id=principal.user_id, limit=limit)
    if items is not None:
        user = principal.user
        if user is not None and not getattr(user, "history_indexed", True):
            store = get_document_store()
            backfill_history_index(
                db,
                user=user,
                records=store.list_documents(limit=500),
            )
            items = list_history_summaries(db, user_id=principal.user_id, limit=limit) or []
        return HistoryListResponse(
            items=[HistoryItem(**item) for item in items],
            storage_backend=settings.storage_backend,
        )
    store = get_document_store()
    owner = str(principal.user_id)
    records = [
        record
        for record in store.list_documents(limit=500)
        if record.owner_id == owner
    ][:limit]
    return HistoryListResponse(
        items=[HistoryItem(**record.summary()) for record in records],
        storage_backend=settings.storage_backend,
    )


def _require_owned_record(document_id: str, principal: Principal):
    if not principal.plan.history or not principal.user_id:
        raise HTTPException(status_code=403, detail={"code": "plan_forbidden", "feature": "history.read"})
    store = get_document_store()
    record = store.get_document(document_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if record.owner_id != str(principal.user_id):
        raise HTTPException(status_code=404, detail="Document not found")
    return store, record


@router.get("/history/{document_id}", response_model=HistoryDetailResponse)
async def get_history_item(
    document_id: str,
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> HistoryDetailResponse:
    store, record = _require_owned_record(document_id, principal)
    upsert_history_summary(db, record)
    markdown, json_data, pages = expand_embedded_media(
        record.markdown,
        record.json_data,
        record.pages,
        store.load_media_files(record.id),
    )
    regions, image_size = _regions_payload(json_data, pages)
    return HistoryDetailResponse(
        id=record.id,
        filename=record.filename,
        content_type=record.content_type,
        size_bytes=record.size_bytes,
        created_at=record.created_at,
        engine=record.engine,
        page_count=record.page_count,
        format=record.output_format,
        markdown=markdown,
        data=json_data,
        pages=pages,
        storage_backend=record.storage_backend,
        file_url=f"/api/history/{record.id}/file",
        regions=regions,
        image_size=image_size,
        structure=record.structure if isinstance(record.structure, dict) else None,
    )


def _is_cross_origin(request: Request) -> bool:
    """True when a browser sent this from an origin other than ours.

    Browsers omit Origin on plain navigations and downloads, so those still get
    the redirect; only CORS callers, which the redirect would break, are refused.
    """
    origin = (request.headers.get("origin") or "").rstrip("/").lower()
    if not origin:
        return False
    return origin != f"{request.url.scheme}://{request.url.netloc}".lower()


@router.get("/history/{document_id}/file-url", response_model=HistoryFileUrlResponse)
async def get_history_file_url(
    document_id: str,
    principal: Principal = Depends(get_principal),
) -> HistoryFileUrlResponse:
    """Hand the browser a URL instead of redirecting it.

    ``/file`` answers with a 307 to a presigned S3 URL, but the fetch spec makes a
    cross-origin redirect opaque: the follow-up preflight carries ``Origin: null``,
    which no bucket rule can match without opening the bucket to every site. With
    the URL in hand the browser calls S3 directly, keeping its real Origin.
    """
    store, record = _require_owned_record(document_id, principal)
    if isinstance(store, S3DocumentStore):
        return HistoryFileUrlResponse(
            url=store.presign_get(
                store.object_key(record.source_key),
                filename=record.filename,
                content_type=record.content_type,
            ),
            filename=record.filename,
            content_type=record.content_type,
            expires_in=PRESIGN_GET_EXPIRES,
        )
    # Local storage serves the bytes itself, so the same-origin path is enough.
    return HistoryFileUrlResponse(
        url=f"/api/history/{document_id}/file",
        filename=record.filename,
        content_type=record.content_type,
    )


@router.get("/history/{document_id}/file")
async def get_history_file(
    document_id: str,
    request: Request,
    principal: Principal = Depends(get_principal),
) -> Response:
    store, record = _require_owned_record(document_id, principal)
    if isinstance(store, S3DocumentStore):
        if _is_cross_origin(request):
            # Redirecting would strand the caller: the browser retries the presigned
            # URL with Origin: null and S3 refuses it, which surfaces as an
            # unexplained CORS error. Say so instead of failing in the browser.
            raise HTTPException(
                status_code=409,
                detail=(
                    "Cross-origin callers cannot follow the redirect to S3. "
                    f"GET /api/history/{document_id}/file-url and fetch the URL it returns."
                ),
            )
        url = store.presign_get(
            store.object_key(record.source_key),
            filename=record.filename,
            content_type=record.content_type,
        )
        return RedirectResponse(url, status_code=307)
    payload = store.get_source_bytes(document_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Document file not found")
    data, filename, content_type = payload
    headers = {"Content-Disposition": content_disposition("inline", filename)}
    return Response(
        content=data,
        media_type=content_type or "application/octet-stream",
        headers=headers,
    )


@router.delete("/history/{document_id}")
async def delete_history_item(
    document_id: str,
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> dict[str, str]:
    store, _record = _require_owned_record(document_id, principal)
    deleted = store.delete_document(document_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    delete_history_summary(db, user_id=principal.user_id, document_id=document_id)
    return {"status": "deleted", "id": document_id}
