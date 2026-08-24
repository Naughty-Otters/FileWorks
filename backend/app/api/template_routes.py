from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import AliasChoices, BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import Principal, get_principal
from app.auth.quota import AI_ACTION, assert_can_use_ai
from app.db.models import UsageEvent, UserTemplate
from app.db.session import get_db
from app.processing.template.extract import extract_template_context
from app.processing.template.render import render_docx, render_html, render_markdown, render_pdf
from app.processing.template.runtime import (
    auto_layout,
    coalesce_context,
    default_context,
    expand_repeats,
    required_context_roots,
    template_analysis,
)
from app.processing.template.schema import DesignDocument
from app.processing.template.starters import (
    get_starter_meta,
    list_categories,
    list_starter_summaries,
    load_starter_document,
)
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
    """Fill params for a saved or built-in template.

    Pass ``variables`` (alias ``context``) to supply values by variable name.
    List variables expect arrays of objects matching each field in ``itemSchema``.
    Set ``envelope`` to receive HTML/markdown plus the filled context as JSON.
    """

    source_markdown: str | None = Field(
        default=None, validation_alias=AliasChoices("source_markdown", "markdown")
    )
    context: dict[str, Any] = Field(
        default_factory=dict, validation_alias=AliasChoices("context", "variables")
    )
    format: Literal["html", "docx", "pdf", "markdown"] = "html"
    fill: Literal["auto", "defaults", "none"] = "auto"
    envelope: bool = False


class StarterVariable(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    label: str = ""
    type: str = "text"
    sample_value: Any = Field(default="", validation_alias=AliasChoices("sample_value", "sampleValue"))
    item_schema: list[dict[str, Any]] = Field(
        default_factory=list, validation_alias=AliasChoices("item_schema", "itemSchema")
    )


class StarterSummary(BaseModel):
    id: str
    name: str
    description: str = ""
    category: str = "general"
    page_size: dict[str, Any] | None = None
    variable_count: int = 0
    variables: list[StarterVariable] = Field(default_factory=list)


class StarterListResponse(BaseModel):
    categories: list[dict[str, Any]] = Field(default_factory=list)
    items: list[StarterSummary]


class StarterDetailResponse(StarterSummary):
    document: DesignDocument


def _workspace(principal: Principal, db: Session | None) -> tuple[str, Session]:
    """Saved Design CRUD is workspace JWT only (not API keys)."""
    if principal.user_id is None or principal.via_api_key:
        raise HTTPException(status_code=401, detail="JWT workspace authentication required")
    if db is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    return str(principal.user_id), db


def _authenticated_user(principal: Principal, db: Session | None) -> tuple[str, Session]:
    """JWT or API-key user — starter catalog for convert `design=` targeting."""
    if principal.user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")
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


def _fill_and_render(
    *,
    document: DesignDocument,
    body: TemplateRenderRequest,
    principal: Principal,
    session: Session,
    title: str,
    filename_stem: str,
    document_description: str | None = None,
) -> Response:
    """Shared fill (defaults / AI / explicit variables) + render pipeline."""
    is_static, warnings = template_analysis(document)
    defaults = default_context(document)
    overrides = dict(body.context)
    needed = required_context_roots(document)
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
            document_name=title,
            document_description=document_description,
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
        if key in context
        and extracted.get(key) == context.get(key)
        and extracted.get(key) not in (None, "", [], {})
    )
    headers = {"X-Template-Fill": fill_mode}
    if filled_keys:
        headers["X-Template-Filled-Keys"] = ",".join(filled_keys)[:1000]
    if warning_header:
        headers["X-Template-Warnings"] = warning_header[:1000]
    if body.format == "docx":
        data = render_docx(laid_out, title=title)
        headers["Content-Disposition"] = f'attachment; filename="{filename_stem}.docx"'
        return Response(
            content=data,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers=headers,
        )
    if body.format == "pdf":
        data = render_pdf(laid_out, title=title)
        headers["Content-Disposition"] = f'attachment; filename="{filename_stem}.pdf"'
        return Response(content=data, media_type="application/pdf", headers=headers)
    html = render_html(laid_out, title=title)
    markdown_out = render_markdown(laid_out)
    if body.format == "markdown" and not body.envelope:
        headers["Content-Disposition"] = f'attachment; filename="{filename_stem}.md"'
        return Response(content=markdown_out, media_type="text/markdown; charset=utf-8", headers=headers)
    if body.envelope or body.format == "markdown":
        return JSONResponse(
            content={
                "html": html,
                "markdown": markdown_out,
                "context": context,
                "fill_mode": fill_mode,
                "filename": f"{filename_stem}.html",
                "warnings": [*warnings, *layout_warnings],
            },
            headers=headers,
        )
    return Response(content=html, media_type="text/html; charset=utf-8", headers=headers)


def _starter_summary(raw: dict[str, Any]) -> StarterSummary:
    variables = []
    for item in raw.get("variables") or []:
        variables.append(
            StarterVariable.model_validate(
                {
                    "name": item.get("name"),
                    "label": item.get("label") or "",
                    "type": item.get("type") or "text",
                    "sampleValue": item.get("sampleValue", item.get("sample_value", "")),
                    "itemSchema": item.get("itemSchema") or item.get("item_schema") or [],
                }
            )
        )
    page_size = raw.get("page_size") or raw.get("pageSize")
    return StarterSummary(
        id=raw["id"],
        name=raw["name"],
        description=raw.get("description") or "",
        category=raw.get("category") or "general",
        page_size=page_size if isinstance(page_size, dict) else None,
        variable_count=int(raw.get("variable_count") or len(variables)),
        variables=variables,
    )


@router.get("/starters", response_model=StarterListResponse)
def list_starters(principal: PrincipalDep, db: DatabaseDep) -> StarterListResponse:
    """Catalog of built-in templates and their variable params (JWT or API key)."""
    _authenticated_user(principal, db)
    return StarterListResponse(
        categories=list_categories(),
        items=[_starter_summary(item) for item in list_starter_summaries()],
    )


@router.get("/starters/{starter_id}", response_model=StarterDetailResponse)
def get_starter(
    starter_id: str,
    principal: PrincipalDep,
    db: DatabaseDep,
) -> StarterDetailResponse:
    """Full built-in starter document + variable schema for API clients."""
    _authenticated_user(principal, db)
    meta = get_starter_meta(starter_id)
    document = load_starter_document(starter_id)
    summary = _starter_summary(
        {
            **meta,
            "variable_count": len(document.variables),
            "variables": meta.get("variables")
            or [
                {
                    "name": variable.name,
                    "label": variable.label,
                    "type": variable.type,
                    "sampleValue": variable.sample_value,
                    "itemSchema": [field.model_dump(by_alias=True) for field in variable.item_schema],
                }
                for variable in document.variables
            ],
            "pageSize": document.page.model_dump(by_alias=True)
            if hasattr(document, "page")
            else meta.get("pageSize"),
        }
    )
    return StarterDetailResponse(**summary.model_dump(), document=document)


@router.post("/starters/{starter_id}/render")
def render_starter(
    starter_id: str,
    body: TemplateRenderRequest,
    principal: PrincipalDep,
    db: DatabaseDep,
) -> Response:
    """Render a built-in starter with ``variables`` / ``context`` (or AI fill from markdown).

    Example::

        POST /api/templates/starters/family_daily/render
        {
          "fill": "none",
          "format": "html",
          "variables": {
            "family_name": "The Riveras",
            "day_name": "Tuesday",
            "family_daily_blocks": [{"time": "7:00 AM", "activity": "Breakfast"}]
          }
        }
    """
    _, session = _authenticated_user(principal, db)
    meta = get_starter_meta(starter_id)
    document = load_starter_document(starter_id)
    return _fill_and_render(
        document=document,
        body=body,
        principal=principal,
        session=session,
        title=str(meta.get("name") or starter_id),
        filename_stem=starter_id,
        document_description=meta.get("description"),
    )


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
    return _fill_and_render(
        document=document,
        body=body,
        principal=principal,
        session=session,
        title=row.name,
        filename_stem=row.id,
        document_description=row.description,
    )
