"""LLM document engine — vision / PDF → Markdown via a configured vendor."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.engines.base import ExtractResult, OCREngine, OutputFormat
from app.engines.llm.catalog import LLMProviderSpec, get_provider_spec, resolve_provider_id
from app.engines.llm.providers import ConvertRequest, LLMClientError, clean_markdown, get_api_provider
from app.engines.llm.urls import LLMHttpTarget, resolve_http_target, supports_file_input
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions
from app.services.pages import PAGE_SEPARATOR, assemble_page_dicts, pdf_page_count


class LLMEngine(OCREngine):
    id = "llm"
    label = "LLM"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._spec: LLMProviderSpec | None = None
        self._init_error: str | None = None
        try:
            if self.settings.llm_provider:
                self._spec = get_provider_spec(self.settings.llm_provider)
        except ValueError as exc:
            self._init_error = str(exc)

    @property
    def spec(self) -> LLMProviderSpec | None:
        return self._spec

    @property
    def ready(self) -> bool:
        return self.configured()

    @property
    def init_error(self) -> str | None:
        if self._init_error:
            return self._init_error
        if not resolve_provider_id(self.settings.llm_provider):
            return "LLM_PROVIDER is not set"
        if self._spec is None:
            return f"Unknown LLM provider '{self.settings.llm_provider}'"
        if not self._api_key():
            fields = " / ".join(f.upper() for f in self._spec.key_fields)
            return f"No API key for {self._spec.label} ({fields} or LLM_API_KEY)"
        return None

    def configured(self) -> bool:
        return self._spec is not None and bool(self._api_key())

    @property
    def supports_vision(self) -> bool:
        if self._spec is None:
            return False
        return supports_file_input(self._spec, self._http_target().openai_base_url())

    @property
    def vision_error(self) -> str | None:
        if self.supports_vision:
            return None
        if self._spec and self._spec.id == "deepseek":
            return (
                "Hosted DeepSeek chat is text-only and rejects image_url. "
                "Set DEEPSEEK_BASE_URL to a vision/OCR host, or use LLM_PROVIDER="
                "openai, claude, gemini, glm, openrouter, fireworks, or grok."
            )
        return "Configured LLM does not accept images or files"

    def ensure_ready(self) -> None:
        error = self.init_error
        if error:
            raise RuntimeError(error)

    def _api_key(self) -> str | None:
        generic = (self.settings.llm_api_key or "").strip()
        if generic:
            return generic
        if self._spec is None:
            return None
        for field in self._spec.key_fields:
            value = getattr(self.settings, field, None)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    def _model(self) -> str:
        override = (self.settings.llm_model or "").strip()
        if override:
            return override
        assert self._spec is not None
        return self._spec.default_model

    def extract(
        self,
        file_path: Path,
        *,
        output_format: OutputFormat = "both",
        options: ExtractOptions | None = None,
        mime_type: str | None = None,
    ) -> ExtractResult:
        del mime_type
        opts = options or DEFAULT_EXTRACT_OPTIONS
        self.ensure_ready()
        assert self._spec is not None
        suffix = file_path.suffix.lower()
        markdowns = self._convert_pages(file_path, suffix)
        source_pages = pdf_page_count(file_path) if suffix == ".pdf" else len(markdowns)
        extra = {
            "provider": self._spec.id,
            "model": self._model(),
            "source_page_count": source_pages or len(markdowns),
        }
        pages, page_count, markdown = assemble_page_dicts(markdowns, source=self.id, extra=extra)
        page_json: dict[str, Any] = {
            "source": self.id,
            **extra,
            "pages": [page["json"] for page in pages],
        }
        if page_count == 1:
            page_json = pages[0]["json"] if pages else {"source": self.id, **extra, "text": markdown}
        return ExtractResult(
            engine="LLM",
            provider=self._spec.id,
            page_count=page_count,
            pages=pages,
            markdown=markdown if output_format in {"markdown", "both"} else None,
            json_data=page_json if output_format in {"json", "both"} else None,
            options=opts.to_dict(),
        )

    def _http_target(self) -> LLMHttpTarget:
        assert self._spec is not None
        return resolve_http_target(self.settings, self._spec)

    def _convert_pages(self, file_path: Path, suffix: str) -> list[str]:
        spec = self._spec
        assert spec is not None
        api_key = self._api_key()
        assert api_key
        if not self.supports_vision:
            raise LLMClientError(self.vision_error or "LLM does not accept files")
        request = ConvertRequest(
            spec=spec,
            file_path=file_path,
            suffix=suffix,
            api_key=api_key,
            model=self._model(),
            max_tokens=int(self.settings.llm_max_tokens),
            timeout_s=float(self.settings.llm_timeout_s),
            target=self._http_target(),
            max_pages=int(self.settings.llm_max_pages),
            max_image_side=int(self.settings.llm_max_image_side),
        )
        provider = get_api_provider(spec.id)
        raw_pages = self._invoke_page_markdowns(provider, request)
        markdowns = [clean_markdown(raw) for raw in raw_pages]
        markdowns = [part for part in markdowns if part] or markdowns
        if not any(markdowns):
            raise LLMClientError(f"{spec.label} returned empty Markdown")
        return markdowns

    @staticmethod
    def _invoke_page_markdowns(provider: Any, request: ConvertRequest) -> list[str]:
        convert_pages = getattr(provider, "convert_pages", None)
        raw_pages: Any = None
        if callable(convert_pages):
            raw_pages = convert_pages(request)
        if not isinstance(raw_pages, (list, tuple)):
            raw_pages = [provider.convert(request)]
        return [str(part or "") for part in raw_pages]

    def _convert(self, file_path: Path, suffix: str) -> str:
        return PAGE_SEPARATOR.join(self._convert_pages(file_path, suffix))

    def _completion_request(self) -> ConvertRequest:
        self.ensure_ready()
        spec = self._spec
        api_key = self._api_key()
        assert spec is not None and api_key
        return ConvertRequest(
            spec=spec,
            file_path=Path("."),
            suffix=".md",
            api_key=api_key,
            model=self._model(),
            max_tokens=int(self.settings.llm_max_tokens),
            timeout_s=float(self.settings.llm_timeout_s),
            target=self._http_target(),
            max_pages=1,
            max_image_side=1,
        )

    def complete_text(self, prompt: str, *, purpose: str = "text") -> str:
        """Text-only completion for post-process edits (structure, not vision OCR)."""
        spec = self._spec
        assert spec is not None
        raw = get_api_provider(spec.id).complete_text(
            self._completion_request(),
            prompt,
            purpose=purpose,
        )
        markdown = clean_markdown(raw)
        if not markdown:
            raise LLMClientError(f"{spec.label} returned empty Markdown")
        return markdown

    def complete_structured(
        self,
        prompt: str,
        schema: dict[str, Any],
        *,
        purpose: str = "text",
    ) -> dict[str, Any]:
        """Text-only completion constrained to a JSON Schema object."""
        spec = self._spec
        assert spec is not None
        return get_api_provider(spec.id).complete_structured(
            self._completion_request(),
            prompt,
            schema,
            purpose=purpose,
        )

    def describe(self) -> dict[str, Any]:
        spec = self._spec
        target = self._http_target() if spec else None
        return {
            "id": self.id,
            "label": self.label,
            "provider": spec.id if spec else None,
            "package": spec.package if spec else None,
            "model": self._model() if spec else None,
            "base_url": target.openai_base_url() if target else None,
            "supports_vision": self.supports_vision if spec else False,
            "ready": self.ready,
            "configured": self.configured(),
            "error": self.init_error,
            "vision_error": self.vision_error,
        }
