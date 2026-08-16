"""Restore heading / list / table structure in already-parsed Markdown."""

from __future__ import annotations

import logging
import threading

from app.core.config import Settings, get_settings
from app.engines.llm.engine import LLMEngine
from app.processing.models import ReadResult
from app.processing.postprocess.media import protect_embedded_images, restore_embedded_images
from app.processing.postprocess.translate import _split_markdown

logger = logging.getLogger(__name__)

STRUCTURE_EDIT_PROMPT = (
    "Restore document structure in the following GitHub-Flavored Markdown. "
    "Output Markdown only — no preamble, no explanation, no code fences around the whole document. "
    "Fix heading levels, lists, and tables (GFM pipes or HTML tables for merged cells). "
    "Preserve reading order and all visible text. Do not invent sections or content. "
    "Keep placeholders like @@FWIMG0@@ unchanged — they stand in for images. "
    "Keep URLs, fenced code, and Markdown syntax intact."
)


class MarkdownStructureEditor:
    """Text-only LLM pass after a non-vision reader. Skip if the LLM is not configured."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._engine = LLMEngine(self.settings)

    def configured(self) -> bool:
        return self._engine.configured()

    def edit_markdown(self, markdown: str) -> str:
        if not (markdown or "").strip():
            return markdown
        if not self.configured():
            return markdown
        protected, held = protect_embedded_images(markdown)
        chunks = _split_markdown(protected, max_chars=int(self.settings.translate_chunk_chars))
        edited: list[str] = []
        for index, chunk in enumerate(chunks):
            from app.services.cancel_token import check_cancelled

            check_cancelled(where=f"structure-edit chunk {index + 1}/{len(chunks)}")
            header = STRUCTURE_EDIT_PROMPT
            if len(chunks) > 1:
                header += f" This is part {index + 1} of {len(chunks)}. Edit this part only."
            edited.append(self._engine.complete_text(f"{header}\n\n{chunk}", purpose="structure-edit"))
        return restore_embedded_images("\n\n".join(edited).strip(), held)

    def apply(self, result: ReadResult) -> ReadResult:
        source = result.markdown()
        try:
            edited = self.edit_markdown(source)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Structure edit skipped: %s", exc)
            return result
        if not edited.strip() or edited.strip() == (source or "").strip():
            return result
        spec = self._engine.spec
        return result.with_markdown(
            edited,
            metadata_extra={
                "structure_edited": True,
                "structure_edit_provider": spec.id if spec else None,
                "structure_edit_model": self._engine.describe().get("model"),
            },
        )


_editor: MarkdownStructureEditor | None = None
_lock = threading.Lock()


def get_markdown_structure_editor() -> MarkdownStructureEditor:
    global _editor
    if _editor is None:
        with _lock:
            if _editor is None:
                _editor = MarkdownStructureEditor()
    return _editor
