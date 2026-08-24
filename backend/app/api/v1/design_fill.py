"""Fill a built-in Design starter from converted Markdown (v1 convert path)."""

from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import HTTPException

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
from app.processing.template.starters import get_starter_meta, load_starter_document

DesignFillMode = Literal["auto", "defaults", "none"]
DesignOutputFormat = Literal["html", "docx", "markdown", "pdf"]


def resolve_design_output_format(target: str) -> DesignOutputFormat:
    key = (target or "html").strip().lower()
    if key in {"docx", "word"}:
        return "docx"
    if key in {"markdown", "md"}:
        return "markdown"
    if key == "pdf":
        return "pdf"
    return "html"


def fill_starter_design(
    *,
    starter_id: str,
    markdown: str,
    fill: DesignFillMode = "auto",
    overrides: dict[str, Any] | None = None,
    output_format: DesignOutputFormat = "html",
    allow_ai_fill: bool = True,
) -> tuple[bytes | str, str, str, str]:
    """Return (body, media_type, filename_ext, fill_mode_used)."""
    meta = get_starter_meta(starter_id)
    document = load_starter_document(starter_id)
    is_static, _warnings = template_analysis(document)
    defaults = default_context(document)
    override_map = dict(overrides or {})
    needed = required_context_roots(document)
    source = (markdown or "").strip()
    fill_mode: str = fill
    extracted: dict[str, Any] = {}

    if is_static:
        context = coalesce_context(defaults, None, override_map)
        fill_mode = "static"
    elif fill == "none":
        context = dict(override_map)
        missing = needed - set(context)
        if missing:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "missing_design_variables",
                    "field": "design_variables",
                    "message": f"Missing Design context: {', '.join(sorted(missing))}",
                },
            )
        fill_mode = "none"
    elif fill == "defaults" or not source or not allow_ai_fill:
        context = coalesce_context(defaults, None, override_map)
        fill_mode = "defaults"
    else:
        extracted = extract_template_context(
            document,
            source,
            document_name=str(meta.get("name") or starter_id),
            document_description=meta.get("description"),
        )
        context = coalesce_context(defaults, extracted, override_map)
        fill_mode = "ai"

    expanded = expand_repeats(document, context)
    laid_out, _layout_warnings = auto_layout(expanded)
    title = str(meta.get("name") or starter_id)

    if output_format == "docx":
        return (
            render_docx(laid_out, title=title),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "docx",
            fill_mode,
        )
    if output_format == "markdown":
        return (
            render_markdown(laid_out),
            "text/markdown; charset=utf-8",
            "md",
            fill_mode,
        )
    if output_format == "pdf":
        return (
            render_pdf(laid_out, title=title),
            "application/pdf",
            "pdf",
            fill_mode,
        )
    return (
        render_html(laid_out, title=title),
        "text/html; charset=utf-8",
        "html",
        fill_mode,
    )


def parse_design_variables(raw: str | None) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_design_variables",
                "field": "design_variables",
                "message": "design_variables must be a JSON object",
            },
        ) from exc
    if not isinstance(parsed, dict):
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_design_variables",
                "field": "design_variables",
                "message": "design_variables must be a JSON object",
            },
        )
    return parsed
