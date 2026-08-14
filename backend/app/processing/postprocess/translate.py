"""Translate Markdown via a separately configured text LLM."""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings
from app.engines.llm.catalog import LLMProviderSpec, get_provider_spec, resolve_provider_id
from app.engines.llm.providers import ConvertRequest, LLMClientError, clean_markdown, get_api_provider
from app.engines.llm.urls import LLMHttpTarget, resolve_http_target
from app.processing.models import DocumentOutput, OutputKind, ReadResult
from app.processing.postprocess.languages import language_label, normalize_target_lang
from app.processing.postprocess.media import protect_embedded_images, restore_embedded_images

logger = logging.getLogger(__name__)

TRANSLATE_PROMPT = (
    "Translate the following GitHub-Flavored Markdown into {language}. "
    "Output Markdown only — no preamble, no explanation, no code fences around the whole document. "
    "Preserve headings, lists, tables, links, images, emphasis, and reading order. "
    "Do not translate URLs, fenced code, inline code, or Markdown syntax. "
    "Keep placeholders like @@FWIMG0@@ unchanged — they stand in for images. "
    "Keep the same structure and heading levels."
)


class MarkdownTranslator:
    """Text-only LLM client used after reading, not for file/vision OCR."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._spec: LLMProviderSpec | None = None
        self._init_error: str | None = None
        try:
            if self.settings.translate_provider:
                self._spec = get_provider_spec(self.settings.translate_provider)
        except ValueError as exc:
            self._init_error = str(exc)

    @property
    def spec(self) -> LLMProviderSpec | None:
        return self._spec

    def configured(self) -> bool:
        return self._spec is not None and bool(self._api_key()) and self._key_mismatch_error() is None

    @property
    def init_error(self) -> str | None:
        if self._init_error:
            return self._init_error
        if not resolve_provider_id(self.settings.translate_provider):
            return "TRANSLATE_PROVIDER is not set"
        if self._spec is None:
            return f"Unknown translate provider '{self.settings.translate_provider}'"
        if not self._api_key():
            fields = " / ".join(f.upper() for f in self._spec.key_fields)
            return f"No API key for translation ({fields} or TRANSLATE_API_KEY)"
        return self._key_mismatch_error()

    def _api_key(self) -> str | None:
        generic = (self.settings.translate_api_key or "").strip()
        if generic:
            return generic
        if self._spec is None:
            return None
        for field in self._spec.key_fields:
            value = getattr(self.settings, field, None)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    def _key_mismatch_error(self) -> str | None:
        """Catch the usual .env paste mistakes before they become a 401."""
        key = self._api_key() or ""
        provider = self._spec.id if self._spec else ""
        if not key or not provider:
            return None
        if "=" in key:
            return (
                "TRANSLATE_API_KEY looks like an env assignment was pasted as the value. "
                "Set it to the raw API key for TRANSLATE_PROVIDER only."
            )
        if provider == "deepseek" and key.startswith(("sk-proj-", "sk-svcacct-")):
            return (
                "TRANSLATE_PROVIDER is deepseek but TRANSLATE_API_KEY looks like an OpenAI key. "
                "Use a DeepSeek key from platform.deepseek.com, or set TRANSLATE_PROVIDER=openai."
            )
        return None

    def _model(self) -> str:
        override = (self.settings.translate_model or "").strip()
        if override:
            return override
        assert self._spec is not None
        return self._spec.default_model

    def _http_target(self) -> LLMHttpTarget:
        assert self._spec is not None
        return resolve_http_target(
            self.settings,
            self._spec,
            endpoint=self.settings.translate_endpoint,
            base_url=self.settings.translate_base_url,
            include_llm_overrides=False,
        )

    def describe(self) -> dict[str, Any]:
        spec = self._spec
        target = self._http_target() if spec else None
        return {
            "id": "translate",
            "label": f"Translate ({spec.label})" if spec else "Translate",
            "provider": spec.id if spec else None,
            "package": spec.package if spec else None,
            "model": self._model() if spec else None,
            "base_url": target.openai_base_url() if target else None,
            "ready": self.configured(),
            "configured": self.configured(),
            "error": self.init_error,
        }

    def translate_markdown(self, markdown: str, target_lang: str) -> str:
        lang = normalize_target_lang(target_lang)
        if not lang:
            return markdown
        if not (markdown or "").strip():
            return markdown
        if not self.configured():
            raise RuntimeError(self.init_error or "Translation is not configured")
        spec = self._spec
        api_key = self._api_key()
        assert spec is not None and api_key
        request = ConvertRequest(
            spec=spec,
            file_path=Path("."),
            suffix=".md",
            api_key=api_key,
            model=self._model(),
            max_tokens=int(self.settings.translate_max_tokens),
            timeout_s=float(self.settings.translate_timeout_s),
            target=self._http_target(),
            max_pages=1,
            max_image_side=1,
        )
        provider = get_api_provider(spec.id)
        label = language_label(lang)
        protected, held = protect_embedded_images(markdown)
        chunks = _split_markdown(protected, max_chars=int(self.settings.translate_chunk_chars))
        translated: list[str] = []
        for index, chunk in enumerate(chunks):
            header = TRANSLATE_PROMPT.format(language=f"{label} ({lang})")
            if len(chunks) > 1:
                header += f" This is part {index + 1} of {len(chunks)}. Translate this part only."
            raw = provider.complete_text(request, f"{header}\n\n{chunk}")
            text = clean_markdown(raw)
            if not text:
                raise LLMClientError(f"Translation returned empty Markdown for part {index + 1}")
            translated.append(text)
        return restore_embedded_images("\n\n".join(translated).strip(), held)

    def apply(self, result: ReadResult, target_lang: str) -> ReadResult:
        lang = normalize_target_lang(target_lang)
        if not lang:
            return result
        source = result.markdown()
        translated = self.translate_markdown(source, lang)
        outputs = [
            DocumentOutput(kind=OutputKind.MARKDOWN, content=translated)
            if item.kind == OutputKind.MARKDOWN
            else item
            for item in result.outputs
        ]
        if not any(item.kind == OutputKind.MARKDOWN for item in outputs):
            outputs.append(DocumentOutput(kind=OutputKind.MARKDOWN, content=translated))
        metadata = dict(result.metadata)
        metadata["translated_to"] = lang
        metadata["translate_provider"] = self._spec.id if self._spec else None
        metadata["translate_model"] = self._model() if self._spec else None
        options = dict(result.options or {})
        options["target_lang"] = lang
        return ReadResult(
            engine_id=result.engine_id,
            engine_label=result.engine_label,
            outputs=outputs,
            pages=result.pages,
            regions=result.regions,
            image_size=result.image_size,
            page_count=result.page_count,
            metadata=metadata,
            options=options,
        )


def _split_markdown(markdown: str, *, max_chars: int) -> list[str]:
    text = markdown.strip()
    if max_chars <= 0 or len(text) <= max_chars:
        return [text]
    blocks = text.split("\n\n")
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for block in blocks:
        extra = len(block) + (2 if current else 0)
        if current and current_len + extra > max_chars:
            chunks.append("\n\n".join(current))
            current = [block]
            current_len = len(block)
        else:
            current.append(block)
            current_len += extra
    if current:
        chunks.append("\n\n".join(current))
    return chunks or [text]


_translator: MarkdownTranslator | None = None
_translator_lock = threading.Lock()


def get_markdown_translator() -> MarkdownTranslator:
    global _translator
    if _translator is None:
        with _translator_lock:
            if _translator is None:
                _translator = MarkdownTranslator(get_settings())
    return _translator
