"""POST /api/v1/convert — one request: file in, converted file out. No s3_key."""

from __future__ import annotations

import logging
import uuid
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.api.v1.catalog import (
    INPUT_EXTENSIONS,
    assert_options_available,
    convert_catalog,
    resolve_language,
    resolve_target,
)
from app.api.v1.schemas import (
    ConvertAppliedOptions,
    ConvertCatalogResponse,
    ConvertResponse,
    ConvertSource,
)
from app.auth.deps import Principal, get_principal
from app.auth.quota import assert_can_extract, assert_can_use_ai, record_extract
from app.core.config import get_settings
from app.db.session import get_db
from app.processing.remote_llm import invoke_remote_convert, needs_remote_llm
from app.services.convert import convert_document
from app.services.export import export_markdown
from app.services.options import ExtractOptions
from app.storage import get_document_store
from app.storage.s3 import S3DocumentStore

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1", tags=["v1 convert"])


def _form_bool(value: bool | str) -> bool:
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _content_disposition(filename: str) -> str:
    fallback = "".join(ch if ch.isascii() and ch not in '"\\/\r\n' else "_" for ch in filename)
    fallback = fallback.strip("._") or "file"
    encoded = quote(filename, safe="")
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


def _validate_file(file: UploadFile, data: bytes) -> tuple[str, str]:
    settings = get_settings()
    original = file.filename or "upload.bin"
    suffix = Path(original).suffix.lower()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds maximum size of {settings.max_upload_mb}MB",
        )
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if suffix not in INPUT_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "unsupported_input",
                "field": "file",
                "message": f"Unsupported file type '{suffix}'.",
                "available": sorted(INPUT_EXTENSIONS),
            },
        )
    return original, suffix


def _s3_store() -> S3DocumentStore | None:
    store = get_document_store()
    return store if isinstance(store, S3DocumentStore) else None


@router.get(
    "/convert",
    response_model=ConvertCatalogResponse,
    summary="List convert inputs, targets, and options",
    description=(
        "Returns accepted file extensions, output targets, parse/translate options, "
        "and whether AI reading and translation are available on this server and plan. "
        "Call this before POST /api/v1/convert. No s3_key."
    ),
)
async def get_convert_options(
    principal: Principal = Depends(get_principal),
) -> ConvertCatalogResponse:
    """Check accepted inputs, output targets, and which options are available now."""
    return ConvertCatalogResponse(**convert_catalog(plan=principal.plan))


@router.post(
    "/convert",
    response_model=None,
    summary="Convert a file in one request",
    description=(
        "Upload `file` plus optional `target` and parse options. "
        "Returns JSON with `markdown` and exported `content`, or the file if `download=true`. "
        "Do not send s3_key. See GET /api/v1/convert for the live option catalog."
    ),
)
async def convert_file(
    file: UploadFile = File(..., description="Source file bytes. Do not send an S3 key."),
    target: str = Form(
        default="markdown",
        description="Output format: markdown (alias md), txt (alias text), html, or json. Default markdown.",
    ),
    download: bool | str = Form(
        default=False,
        description="If true, return the converted file instead of JSON.",
    ),
    use_ai: bool | str = Form(
        default=False,
        description="AI reading for images and scanned PDFs. Default false. Requires capabilities.ai.",
    ),
    prefer_structure: bool | str = Form(
        default=False,
        description="Recover headings, lists, and layout on PDFs and scans. Slower. Default false.",
    ),
    use_doc_preprocessor: bool | str = Form(
        default=False,
        description="Orientation and unwarping cleanup. Default false.",
    ),
    use_seal_recognition: bool | str = Form(
        default=False,
        description="Stamps and seals. Default false.",
    ),
    use_table_recognition: bool | str = Form(
        default=True,
        description="Recover grid and table layout. Default true.",
    ),
    use_formula_recognition: bool | str = Form(
        default=False,
        description="Math formulas as LaTeX. Default false.",
    ),
    use_chart_recognition: bool | str = Form(
        default=False,
        description="Charts to structured data. Default false.",
    ),
    use_region_detection: bool | str = Form(
        default=True,
        description="Layout region analysis. Default true.",
    ),
    format_block_content: bool | str = Form(
        default=True,
        description="Markdown / HTML block formatting. Default true.",
    ),
    target_lang: str = Form(
        default="",
        description="Translate after reading: original (skip) or en, zh, zh-TW, ja, ko, fr, de, es, pt, it, ru, ar, hi, vi, th, id, nl, pl, tr.",
    ),
    principal: Principal = Depends(get_principal),
    db: Session | None = Depends(get_db),
) -> ConvertResponse | Response:
    """Convert and export in one call. Workspace extract/export/presign are unchanged."""
    settings = get_settings()
    assert_can_extract(db, user_id=principal.user_id, plan=principal.plan)
    target_info = resolve_target(target)
    lang = resolve_language(target_lang)
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
        target_lang=lang,
    )
    assert_options_available(use_ai=options.use_ai, target_lang=options.normalized_target_lang())
    assert_can_use_ai(
        db,
        user_id=principal.user_id,
        plan=principal.plan,
        use_ai=options.use_ai,
        translate=bool(options.normalized_target_lang()),
    )

    data = await file.read()
    original_name, suffix = _validate_file(file, data)
    mime_type = file.content_type
    document_id = uuid.uuid4().hex
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    temp_path = settings.upload_dir / f"v1-{document_id}{suffix}"

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
                owner = str(principal.user_id) if principal.user_id else (
                    principal.anonymous_id or "anonymous"
                )
                try:
                    remote_key = store.upload_object_key(owner, document_id, original_name)
                except ValueError:
                    remote_key = store.upload_object_key("anonymous", document_id, original_name)
                store.put_bytes(remote_key, data, mime_type)
                result = invoke_remote_convert(
                    bucket=store.upload_bucket,
                    key=remote_key,
                    filename=original_name,
                    content_type=mime_type,
                    output_format="both",
                    options=options,
                )
            else:
                result = convert_document(
                    temp_path,
                    output_format="both",
                    options=options,
                    mime_type=mime_type,
                    filename=original_name,
                )
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("v1 convert failed")
            raise HTTPException(status_code=500, detail=f"Conversion failed: {exc}") from exc

        markdown = result.get("markdown") or ""
        title = Path(original_name).stem or "document"
        try:
            exported, media_type, ext = export_markdown(
                markdown,
                fmt=str(target_info["id"]),
                title=title,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        record_extract(
            db,
            user_id=principal.user_id,
            anonymous_id=principal.anonymous_id,
            enhanced=options.use_ai or bool(options.normalized_target_lang()),
        )

        out_name = f"{title}.{ext}"
        if _form_bool(download):
            return Response(
                content=exported,
                media_type=media_type,
                headers={"Content-Disposition": _content_disposition(out_name)},
            )

        try:
            content = exported.decode("utf-8")
        except UnicodeDecodeError:
            content = exported.decode("utf-8", errors="replace")

        return ConvertResponse(
            id=document_id,
            source=ConvertSource(
                filename=original_name,
                extension=suffix,
                content_type=mime_type,
                size_bytes=len(data),
            ),
            target=str(target_info["id"]),
            filename=out_name,
            media_type=media_type,
            markdown=markdown,
            content=content,
            options=ConvertAppliedOptions(**options.to_dict()),
            engine=str(result.get("engine") or "unknown"),
            page_count=int(result.get("page_count", 0)),
        )
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                logger.warning("Failed to clean up temp upload %s", temp_path)
