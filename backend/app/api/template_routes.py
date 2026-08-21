from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import Principal, get_principal
from app.auth.quota import AI_ACTION, assert_can_use_ai
from app.db.models import UsageEvent, UserTemplate
from app.db.session import get_db
from app.processing.template.extract import extract_template_context
from app.processing.template.render import render_docx, render_html, render_markdown
from app.processing.template.runtime import (
    auto_layout,
    coalesce_context,
    default_context,
    expand_repeats,
    template_analysis,
    used_variables,
)
from app.processing.template.schema import DesignDocument
from app.storage.templates import get_template_store

router = APIRouter(prefix="/templates", tags=["templates"])
PrincipalDep = Annotated[Principal, Depends(get_principal)]
DatabaseDep = Annotated[Session | None, Depends(get_db)]


class TemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    page_label: str | None = Field(default=None, max_length=64)
    document: DesignDocument


class TemplateUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    page_label: str | None = Field(default=None, max_length=64)
    document: DesignDocument | None = None


class TemplateResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    description: str | None
    page_label: str | None
    variable_count: int
    has_repeaters: bool
    storage_backend: str
    created_at: datetime
    updated_at: datetime
    is_static: bool
    warnings: list[str] = Field(default_factory=list)
    document: DesignDocument | None = None


class TemplateListResponse(BaseModel):
    items: list[TemplateResponse]


class TemplateRenderRequest(BaseModel):
    source_markdown: str | None = Field(
        default=None, validation_alias=AliasChoices("source_markdown", "markdown")
    )
    context: dict[str, Any] = Field(
        default_factory=dict, validation_alias=AliasChoices("context", "variables")
    )
    format: Literal["html", "docx", "pdf", "markdown"] = "html"
    fill: Literal["auto", "defaults", "none"] = "auto"


def _workspace(principal: Principal, db: Session | None) -> tuple[str, Session]:
    if principal.user_id is None or principal.via_api_key:
        raise HTTPException(status_code=401, detail="JWT workspace authentication required")
    if db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    return str(principal.user_id), db


def _owned(db: Session, user_id: object, template_id: str) -> UserTemplate:
    row = db.scalar(
        select(UserTemplate).where(
            UserTemplate.id == template_id,
            UserTemplate.user_id == user_id,
        )
    )
    if not isinstance(row, UserTemplate):
        raise HTTPException(status_code=404, detail="Template not found")
    return row


def _load_document(owner_id: str, template_id: str) -> DesignDocument:
    payload = get_template_store().get(owner_id, template_id)
    if payload is None:
        raise HTTPException(status_code=404, detail="Template design not found")
    try:
        return DesignDocument.model_validate(payload)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Stored template is invalid") from exc


def _response(row: UserTemplate, document: DesignDocument | None = None) -> TemplateResponse:
    if document is None:
        is_static = row.variable_count == 0 and not row.has_repeaters
        warnings: list[str] = []
    else:
        is_static, warnings = template_analysis(document)
    now = datetime.now(UTC)
    return TemplateResponse(
        id=row.id,
        name=row.name,
        description=row.description,
        page_label=row.page_label,
        variable_count=row.variable_count,
        has_repeaters=row.has_repeaters,
        storage_backend=row.storage_backend,
        created_at=row.created_at or now,
        updated_at=row.updated_at or now,
        is_static=is_static,
        warnings=warnings,
        document=document,
    )


def _update_metadata(row: UserTemplate, document: DesignDocument) -> None:
    row.variable_count = len(document.variables)
    row.has_repeaters = any(node.repeat is not None for node in document.iter_nodes())


def _try_load_document(owner_id: str, template_id: str) -> DesignDocument | None:
    """Load a stored design; return None if missing/corrupt so list stays up."""
    payload = get_template_store().get(owner_id, template_id)
    if payload is None:
        return None
    try:
        return DesignDocument.model_validate(payload)
    except ValueError:
        return None


@router.get("", response_model=TemplateListResponse)
def list_templates(
    principal: PrincipalDep,
    db: DatabaseDep,
) -> TemplateListResponse:
    _, session = _workspace(principal, db)
    rows = session.scalars(
        select(UserTemplate)
        .where(UserTemplate.user_id == principal.user_id)
        .order_by(UserTemplate.updated_at.desc())
    ).all()
    items: list[TemplateResponse] = []
    owner_id = str(principal.user_id)
    for row in rows:
        if not isinstance(row, UserTemplate):
            continue
        document = _try_load_document(owner_id, row.id)
        items.append(_response(row, document))
    return TemplateListResponse(items=items)


@router.post("", response_model=TemplateResponse, status_code=201)
def create_template(
    body: TemplateCreate,
    principal: PrincipalDep,
    db: DatabaseDep,
) -> TemplateResponse:
    owner_id, session = _workspace(principal, db)
    template_id = uuid.uuid4().hex
    store = get_template_store()
    row = UserTemplate(
        id=template_id,
        user_id=principal.user_id,
        name=body.name.strip(),
        description=body.description,
        page_label=body.page_label,
        storage_backend=store.backend_name,
    )
    _update_metadata(row, body.document)
    store.save(owner_id, template_id, body.document.model_dump(by_alias=True, mode="json"))
    session.add(row)
    session.flush()
    return _response(row, body.document)


@router.get("/{template_id}", response_model=TemplateResponse)
def get_template(
    template_id: str,
    principal: PrincipalDep,
    db: DatabaseDep,
) -> TemplateResponse:
    owner_id, session = _workspace(principal, db)
    row = _owned(session, principal.user_id, template_id)
    return _response(row, _load_document(owner_id, template_id))


@router.put("/{template_id}", response_model=TemplateResponse)
def update_template(
    template_id: str,
    body: TemplateUpdate,
    principal: PrincipalDep,
    db: DatabaseDep,
) -> TemplateResponse:
    owner_id, session = _workspace(principal, db)
    row = _owned(session, principal.user_id, template_id)
    document = body.document or _load_document(owner_id, template_id)
    supplied = body.model_fields_set
    if "name" in supplied and body.name is not None:
        row.name = body.name.strip()
    if "description" in supplied:
        row.description = body.description
    if "page_label" in supplied:
        row.page_label = body.page_label
    if body.document is not None:
        get_template_store().save(
            owner_id, template_id, document.model_dump(by_alias=True, mode="json")
        )
        _update_metadata(row, document)
    row.updated_at = datetime.now(UTC)
    session.add(row)
    session.flush()
    return _response(row, document)


@router.delete("/{template_id}")
def delete_template(
    template_id: str,
    principal: PrincipalDep,
    db: DatabaseDep,
) -> dict[str, str]:
    owner_id, session = _workspace(principal, db)
    row = _owned(session, principal.user_id, template_id)
    get_template_store().delete(owner_id, template_id)
    session.delete(row)
    return {"status": "deleted", "id": template_id}


@router.post("/{template_id}/duplicate", response_model=TemplateResponse, status_code=201)
def duplicate_template(
    template_id: str,
    principal: PrincipalDep,
    db: DatabaseDep,
) -> TemplateResponse:
    owner_id, session = _workspace(principal, db)
    source = _owned(session, principal.user_id, template_id)
    document = _load_document(owner_id, template_id)
    new_id = uuid.uuid4().hex
    row = UserTemplate(
        id=new_id,
        user_id=principal.user_id,
        name=f"{source.name} copy"[:255],
        description=source.description,
        page_label=source.page_label,
        storage_backend=get_template_store().backend_name,
    )
    _update_metadata(row, document)
    get_template_store().save(owner_id, new_id, document.model_dump(by_alias=True, mode="json"))
    session.add(row)
    session.flush()
    return _response(row, document)


@router.post("/{template_id}/render")
def render_template(
    template_id: str,
    body: TemplateRenderRequest,
    principal: PrincipalDep,
    db: DatabaseDep,
) -> Response:
    owner_id, session = _workspace(principal, db)
    row = _owned(session, principal.user_id, template_id)
    document = _load_document(owner_id, template_id)
    is_static, warnings = template_analysis(document)
    defaults = default_context(document)
    overrides = dict(body.context)
    needed = set(document.variable_map())
    needed.update(path.split(".", 1)[0] for path in used_variables(document))
    markdown = (body.source_markdown or "").strip()
    fill_mode = "static" if is_static else body.fill
    extracted: dict[str, Any] = {}

    if is_static:
        context = coalesce_context(defaults, None, overrides)
        fill_mode = "static"
    elif body.fill == "none":
        context = dict(overrides)
        missing = needed - set(context)
        if missing:
            raise HTTPException(
                status_code=400,
                detail=f"Missing template context: {', '.join(sorted(missing))}",
            )
        fill_mode = "none"
    elif body.fill == "defaults" or not markdown:
        context = coalesce_context(defaults, None, overrides)
        missing = needed - set(context)
        if missing and body.fill != "defaults":
            raise HTTPException(
                status_code=400,
                detail=f"Missing template context: {', '.join(sorted(missing))}",
            )
        fill_mode = "defaults"
    else:
        # auto + source markdown: always AI-fill; defaults only coalesce empties.
        assert_can_use_ai(
            session,
            user_id=principal.user_id,
            plan=principal.plan,
            use_ai=True,
            translate=False,
        )
        extracted = extract_template_context(
            document,
            markdown,
            document_name=row.name,
            document_description=row.description,
        )
        context = coalesce_context(defaults, extracted, overrides)
        session.add(UsageEvent(user_id=principal.user_id, action=AI_ACTION))
        fill_mode = "ai"

    expanded = expand_repeats(document, context)
    laid_out, layout_warnings = auto_layout(expanded)
    warning_header = " | ".join([*warnings, *layout_warnings])
    filled_keys = sorted(
        key
        for key in extracted
        if key in context and extracted.get(key) == context.get(key) and extracted.get(key) not in (None, "", [], {})
    )
    headers = {
        "X-Template-Fill": fill_mode,
    }
    if filled_keys:
        headers["X-Template-Filled-Keys"] = ",".join(filled_keys)[:1000]
    if warning_header:
        headers["X-Template-Warnings"] = warning_header[:1000]
    if body.format == "docx":
        data = render_docx(laid_out, title=row.name)
        headers["Content-Disposition"] = f'attachment; filename="{row.id}.docx"'
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers=headers,
        )
    if body.format == "markdown":
        text = render_markdown(laid_out)
        headers["Content-Disposition"] = f'attachment; filename="{row.id}.md"'
        return Response(content=text, media_type="text/markdown; charset=utf-8", headers=headers)
    html = render_html(laid_out, title=row.name)
    if body.format == "pdf":
        headers["X-FileWorks-PDF-Mode"] = "browser-print"
    return Response(content=html, media_type="text/html; charset=utf-8", headers=headers)
