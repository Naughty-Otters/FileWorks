"""Options catalog for the v1 one-shot convert API.

Mirrors what the workspace UI offers (upload types, parse toggles, download
formats, languages) without sharing the extract / presign / export routes.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app.api.schemas import public_error
from app.auth.api_plans import AI_CREDITS_PER_PAGE, STANDARD_CREDITS_PER_PAGE
from app.auth.plans import Plan
from app.core.config import get_settings
from app.processing.pipeline import get_document_pipeline
from app.processing.pipeline_config import get_pipeline_spec
from app.processing.postprocess import get_markdown_translator, language_catalog
from app.processing.postprocess.languages import LANGUAGES, normalize_target_lang
from app.services.options import DEFAULT_EXTRACT_OPTIONS, OPTION_KEYS

# Same families the workspace picker accepts.
INPUT_GROUPS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("image", "Images", (".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp")),
    ("pdf", "PDF", (".pdf",)),
    ("word", "Word", (".doc", ".docx", ".docm")),
    ("powerpoint", "PowerPoint", (".ppt", ".pps", ".pot", ".pptx", ".pptm", ".ppsx", ".ppsm")),
    ("excel", "Excel", (".xls", ".xlsx", ".xlsm", ".xlsb")),
    ("opendocument", "OpenDocument", (".odt", ".ods", ".odp")),
    ("richtext", "Rich text", (".rtf",)),
    ("ebook", "Ebook", (".epub",)),
    ("text", "Text / Markdown", (".txt", ".md", ".markdown", ".csv")),
)

INPUT_EXTENSIONS = {ext for _id, _label, exts in INPUT_GROUPS for ext in exts}

# Workspace download menu. PDF is browser print, not a server export.
TARGETS: tuple[dict[str, Any], ...] = (
    {
        "id": "markdown",
        "label": "Markdown",
        "aliases": ["md"],
        "media_type": "text/markdown; charset=utf-8",
        "extension": "md",
        "available": True,
        "unavailable_reason": None,
    },
    {
        "id": "txt",
        "label": "Plain text",
        "aliases": ["text"],
        "media_type": "text/plain; charset=utf-8",
        "extension": "txt",
        "available": True,
        "unavailable_reason": None,
    },
    {
        "id": "html",
        "label": "HTML",
        "aliases": [],
        "media_type": "text/html; charset=utf-8",
        "extension": "html",
        "available": True,
        "unavailable_reason": None,
    },
    {
        "id": "json",
        "label": "JSON",
        "aliases": [],
        "media_type": "application/json; charset=utf-8",
        "extension": "json",
        "available": True,
        "unavailable_reason": None,
    },
    {
        "id": "docx",
        "label": "Word",
        "aliases": ["word"],
        "media_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "extension": "docx",
        "available": True,
        "unavailable_reason": None,
    },
    {
        "id": "pdf",
        "label": "PDF (print)",
        "aliases": [],
        "media_type": "application/pdf",
        "extension": "pdf",
        "available": False,
        "unavailable_reason": "PDF is a browser print step in the app. Use target=html.",
    },
)

OPTION_META: dict[str, dict[str, str]] = {
    "use_ai": {
        "label": "Read with AI",
        "description": "Uses AI to read images and scanned PDFs.",
    },
    "prefer_structure": {
        "label": "Prefer structure",
        "description": "Recover headings, lists, and layout on PDFs and scans. Slower.",
    },
    "preserve_images": {
        "label": "Preserve images",
        "description": "Keep original charts and figures next to extracted text on each page.",
    },
    "ocr_high_quality": {
        "label": "High-quality OCR",
        "description": "Allow up to ~300 dpi (2480 px) for scans. Uses more memory.",
    },
    "use_doc_preprocessor": {
        "label": "Doc preprocessor",
        "description": "Orientation and unwarping cleanup.",
    },
    "use_table_recognition": {
        "label": "Table recognition",
        "description": "Recover grid and table layout.",
    },
    "use_formula_recognition": {
        "label": "Formula recognition",
        "description": "Math formulas as LaTeX.",
    },
    "use_seal_recognition": {
        "label": "Seal recognition",
        "description": "Stamps and seals.",
    },
    "use_chart_recognition": {
        "label": "Chart recognition",
        "description": "Charts to structured data.",
    },
    "use_region_detection": {
        "label": "Region detection",
        "description": "Layout region analysis.",
    },
    "format_block_content": {
        "label": "Format block content",
        "description": "Markdown / HTML block formatting.",
    },
}

def _ai_ready() -> tuple[bool, str | None]:
    settings = get_settings()
    if settings.llm_lambda_function:
        return True, None
    for item in get_document_pipeline().list_readers():
        if item.get("id") != "llm":
            continue
        if bool(item.get("configured")) and bool(item.get("supports_vision")):
            return True, None
        raw = str(item.get("error") or item.get("vision_error") or "") or None
        return False, public_error(raw) or "AI reading is not configured"
    return False, "AI reading is not configured"


def _translate_ready() -> tuple[bool, str | None]:
    settings = get_settings()
    if settings.llm_lambda_function:
        return True, None
    translator = get_markdown_translator()
    if translator.configured():
        return True, None
    return False, public_error(translator.init_error) or "Translation is not configured"


def available_target_ids() -> list[str]:
    return [str(item["id"]) for item in TARGETS if item["available"]]


def resolve_target(target: str | None) -> dict[str, Any]:
    key = (target or "markdown").strip().lower() or "markdown"
    for item in TARGETS:
        aliases = {item["id"], *[str(alias).lower() for alias in item["aliases"]]}
        if key not in aliases:
            continue
        if not item["available"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "unsupported_target",
                    "field": "target",
                    "message": item["unavailable_reason"] or f"Target '{key}' is not available.",
                    "available": available_target_ids(),
                },
            )
        return item
    raise HTTPException(
        status_code=400,
        detail={
            "code": "unsupported_target",
            "field": "target",
            "message": f"Unsupported target '{target}'.",
            "available": available_target_ids(),
        },
    )


def resolve_language(target_lang: str | None) -> str:
    raw = (target_lang or "").strip()
    normalized = normalize_target_lang(raw)
    if not normalized:
        return ""
    known = {item[0].lower(): item[0] for item in LANGUAGES if item[0] != "original"}
    if normalized.lower() not in known:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "unsupported_language",
                "field": "target_lang",
                "message": f"Unsupported language '{raw}'.",
                "available": [item["id"] for item in language_catalog()],
            },
        )
    return known[normalized.lower()]


def convert_catalog(
    *,
    plan: Plan | None = None,
    api_plan: str | None = None,
    via_api_key: bool = False,
    credits: dict[str, int | None] | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    ai_available, ai_reason = _ai_ready()
    translate_available, translate_reason = _translate_ready()
    defaults = DEFAULT_EXTRACT_OPTIONS.to_dict()

    options: list[dict[str, Any]] = [
        {
            "name": "target",
            "type": "enum",
            "label": "Output format",
            "description": "Format returned in `content`. DOCX is base64 in JSON unless download=true.",
            "default": "markdown",
            "values": available_target_ids(),
            "available": True,
            "allowed": True,
            "unavailable_reason": None,
        },
        {
            "name": "download",
            "type": "boolean",
            "label": "Download file",
            "description": "If true, the response body is the converted file instead of JSON.",
            "default": False,
            "available": True,
            "allowed": True,
            "unavailable_reason": None,
        },
    ]
    for key in OPTION_KEYS:
        meta = OPTION_META[key]
        if key == "use_ai":
            available = ai_available
            allowed = available and (via_api_key or plan is None or plan.ai)
            reason = None if available else ai_reason
        else:
            available = True
            allowed = True if via_api_key or plan is None else bool(plan.extract)
            reason = None
        options.append(
            {
                "name": key,
                "type": "boolean",
                "label": meta["label"],
                "description": meta["description"],
                "default": bool(defaults[key]),
                "available": available,
                "allowed": allowed,
                "unavailable_reason": reason,
            }
        )
    options.append(
        {
            "name": "target_lang",
            "type": "enum",
            "label": "Translate to",
            "description": "Translate after reading. Use `original` to skip.",
            "default": "original",
            "values": [item["id"] for item in language_catalog()],
            "available": translate_available,
            "allowed": (via_api_key or plan is None or plan.translate) and translate_available,
            "unavailable_reason": None if translate_available else translate_reason,
        }
    )

    try:
        from app.processing.template.starters import list_starter_summaries

        design_items = list_starter_summaries()
        design_ids = [item["id"] for item in design_items]
    except Exception:  # noqa: BLE001
        design_items = []
        design_ids = []

    options.append(
        {
            "name": "design",
            "type": "enum",
            "label": "Design starter",
            "description": (
                "Optional built-in Design id (invoice, family_daily, …). "
                "When set, convert fills that Design from the extracted Markdown and returns "
                "the Design as content (html/docx/md via target)."
            ),
            "default": "",
            "values": design_ids,
            "available": bool(design_ids),
            "allowed": bool(design_ids),
            "unavailable_reason": None if design_ids else "Design starters are not packaged on this server",
        }
    )
    options.append(
        {
            "name": "design_fill",
            "type": "enum",
            "label": "Design fill mode",
            "description": (
                "How to fill Design placeholders: auto (AI from Markdown), defaults (samples), "
                "or none (require design_variables JSON)."
            ),
            "default": "auto",
            "values": ["auto", "defaults", "none"],
            "available": True,
            "allowed": True,
            "unavailable_reason": None,
        }
    )

    return {
        "max_upload_mb": settings.max_upload_mb,
        "plan": None if plan is None else plan.id,
        "api_plan": api_plan,
        "inputs": [
            {"id": group_id, "label": label, "extensions": list(extensions)}
            for group_id, label, extensions in INPUT_GROUPS
        ],
        "input_extensions": sorted(INPUT_EXTENSIONS),
        "targets": [dict(item) for item in TARGETS],
        "languages": language_catalog(),
        "options": options,
        "capabilities": {
            "ai": ai_available,
            "translate": translate_available,
        },
        "credits": {
            "standard_per_page": STANDARD_CREDITS_PER_PAGE,
            "ai_per_page": AI_CREDITS_PER_PAGE,
            "used": None if credits is None else credits.get("used_credits"),
            "limit": None if credits is None else credits.get("limit_credits"),
            "remaining": None if credits is None else credits.get("remaining_credits"),
        },
        "pipeline": get_pipeline_spec(settings).to_public_dict(),
        "designs": design_items,
    }


def assert_options_available(*, use_ai: bool, target_lang: str) -> None:
    catalog = convert_catalog()
    if use_ai:
        option = next(item for item in catalog["options"] if item["name"] == "use_ai")
        if not option["available"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "option_unavailable",
                    "field": "use_ai",
                    "message": option["unavailable_reason"] or "AI reading is not available.",
                    "available": False,
                },
            )
    if target_lang:
        option = next(item for item in catalog["options"] if item["name"] == "target_lang")
        if not option["available"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "option_unavailable",
                    "field": "target_lang",
                    "message": option["unavailable_reason"] or "Translation is not available.",
                    "available": ["original"],
                },
            )
