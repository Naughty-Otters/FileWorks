"""Built-in DesignDocument starters shared with the frontend registry.

Documents are exported from ``frontend/src/design-pad/templates.ts`` into
``starters/data/`` so the API can list variable schemas and render with
``variables`` / ``context`` without requiring clients to POST a full document.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app.processing.template.schema import DesignDocument

_DATA_DIR = Path(__file__).resolve().parent / "data"


@lru_cache(maxsize=1)
def _catalog() -> dict[str, Any]:
    path = _DATA_DIR / "catalog.json"
    if not path.is_file():
        raise HTTPException(
            status_code=503,
            detail="Built-in starter catalog is missing — run frontend export:starters",
        )
    return json.loads(path.read_text(encoding="utf-8"))


def list_starter_summaries() -> list[dict[str, Any]]:
    catalog = _catalog()
    return [
        {
            "id": item["id"],
            "name": item["name"],
            "description": item.get("description") or "",
            "category": item.get("category") or "general",
            "page_size": item.get("pageSize") or item.get("page_size"),
            "variables": item.get("variables") or [],
            "variable_count": len(item.get("variables") or []),
        }
        for item in catalog.get("starters") or []
    ]


def list_categories() -> list[dict[str, Any]]:
    return list(_catalog().get("categories") or [])


def get_starter_meta(starter_id: str) -> dict[str, Any]:
    for item in _catalog().get("starters") or []:
        if item.get("id") == starter_id:
            return item
    raise HTTPException(status_code=404, detail=f"Unknown starter template: {starter_id}")


def load_starter_document(starter_id: str) -> DesignDocument:
    meta = get_starter_meta(starter_id)
    filename = meta.get("document_file") or f"{starter_id}.json"
    path = _DATA_DIR / str(filename)
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"Starter document missing: {starter_id}")
    try:
        return DesignDocument.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"Starter document invalid: {starter_id}") from exc


def clear_starter_cache() -> None:
    _catalog.cache_clear()
