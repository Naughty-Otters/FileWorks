from __future__ import annotations

import re
from typing import Any

from app.processing.postprocess.media import protect_embedded_images, restore_embedded_images

_DANGLING_PLACEHOLDER_RE = re.compile(r"@@FWIMG\d*$")


def _cut_text(value: str | None, fraction: float = 0.5) -> str | None:
    if not value:
        return value
    protected, held = protect_embedded_images(value)
    keep = max(1, int(len(protected) * fraction))
    if keep >= len(protected):
        return restore_embedded_images(protected, held)
    cut = _DANGLING_PLACEHOLDER_RE.sub("", protected[:keep])
    return restore_embedded_images(cut, held) + "\n\n… Sign in to see the full result."


def redact_extract_payload(markdown: str | None, json_data: Any, pages: list) -> tuple[str | None, Any, list]:
    md = _cut_text(markdown)
    data = json_data
    if isinstance(json_data, dict) and isinstance(json_data.get("text"), str):
        data = {**json_data, "text": _cut_text(json_data["text"])}
    trimmed_pages: list = []
    for page in pages or []:
        if not isinstance(page, dict):
            trimmed_pages.append(page)
            continue
        item = dict(page)
        if isinstance(item.get("markdown"), str):
            item["markdown"] = _cut_text(item["markdown"])
        trimmed_pages.append(item)
    return md, data, trimmed_pages
