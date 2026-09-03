"""Design Agent LLM client — separate from the vision OCR reader."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.core.config import Settings, get_settings
from app.engines.llm.catalog import LLMProviderSpec, get_provider_spec, resolve_provider_id
from app.engines.llm.providers import ConvertRequest, LLMClientError, get_api_provider
from app.engines.llm.urls import LLMHttpTarget, resolve_http_target


class DesignAgentEngine:
    """Text structured-completion client for template design chat.

    Uses ``DESIGN_AGENT_*`` settings. Falls back to the vision ``LLM_*`` stack
    when ``DESIGN_AGENT_PROVIDER`` is unset so existing deployments keep working.
    """

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or get_settings()
        self._spec: LLMProviderSpec | None = None
        self._init_error: str | None = None
        self._using_llm_fallback = False
        try:
            provider = (self.settings.design_agent_provider or "").strip()
            if provider:
                self._spec = get_provider_spec(provider)
            elif (self.settings.llm_provider or "").strip():
                self._spec = get_provider_spec(self.settings.llm_provider)
                self._using_llm_fallback = True
        except ValueError as exc:
            self._init_error = str(exc)

    @property
    def spec(self) -> LLMProviderSpec | None:
        return self._spec

    def configured(self) -> bool:
        return self._spec is not None and bool(self._api_key())

    @property
    def init_error(self) -> str | None:
        if self._init_error:
            return self._init_error
        if self._spec is None:
            if not resolve_provider_id(self.settings.design_agent_provider) and not resolve_provider_id(
                self.settings.llm_provider
            ):
                return "DESIGN_AGENT_PROVIDER (or LLM_PROVIDER fallback) is not set"
            return (
                f"Unknown design agent provider "
                f"'{self.settings.design_agent_provider or self.settings.llm_provider}'"
            )
        if not self._api_key():
            fields = " / ".join(f.upper() for f in self._spec.key_fields)
            return (
                f"No API key for Design Agent "
                f"({fields} or DESIGN_AGENT_API_KEY"
                f"{' / LLM_API_KEY' if self._using_llm_fallback else ''})"
            )
        return None

    def _api_key(self) -> str | None:
        if not self._using_llm_fallback:
            generic = (self.settings.design_agent_api_key or "").strip()
            if generic:
                return generic
        else:
            generic = (self.settings.llm_api_key or "").strip()
            if generic:
                return generic
            # Prefer design-agent key if someone only set that while falling back.
            design_key = (self.settings.design_agent_api_key or "").strip()
            if design_key:
                return design_key
        if self._spec is None:
            return None
        for field in self._spec.key_fields:
            value = getattr(self.settings, field, None)
            if isinstance(value, str) and value.strip():
                return value.strip()
        if not self._using_llm_fallback:
            # Allow reusing the vision LLM key when provider matches and DESIGN_AGENT_API_KEY unset.
            llm_key = (self.settings.llm_api_key or "").strip()
            if llm_key and resolve_provider_id(self.settings.llm_provider) == self._spec.id:
                return llm_key
        return None

    def _model(self) -> str:
        if self._using_llm_fallback:
            override = (self.settings.llm_model or "").strip()
        else:
            override = (self.settings.design_agent_model or "").strip()
        if override:
            return override
        assert self._spec is not None
        return self._spec.default_model

    def _http_target(self) -> LLMHttpTarget:
        assert self._spec is not None
        if self._using_llm_fallback:
            return resolve_http_target(self.settings, self._spec, include_llm_overrides=True)
        return resolve_http_target(
            self.settings,
            self._spec,
            endpoint=self.settings.design_agent_endpoint,
            base_url=self.settings.design_agent_base_url,
            include_llm_overrides=False,
        )

    def _max_tokens(self) -> int:
        if self._using_llm_fallback:
            return max(int(self.settings.llm_max_tokens), 16384)
        return int(self.settings.design_agent_max_tokens)

    def _timeout_s(self) -> float:
        if self._using_llm_fallback:
            return float(self.settings.llm_timeout_s)
        return float(self.settings.design_agent_timeout_s)

    def _completion_request(self, *, purpose: str = "design-edit") -> ConvertRequest:
        if not self.configured():
            raise RuntimeError(self.init_error or "Design Agent is not configured")
        spec = self._spec
        api_key = self._api_key()
        assert spec is not None and api_key
        return ConvertRequest(
            spec=spec,
            file_path=Path("."),
            suffix=".md",
            api_key=api_key,
            model=self._model(),
            max_tokens=self._max_tokens(),
            timeout_s=self._timeout_s(),
            target=self._http_target(),
            max_pages=1,
            max_image_side=1,
            purpose=purpose,
        )

    def complete_structured(
        self,
        prompt: str,
        schema: dict[str, Any],
        *,
        purpose: str = "design-edit",
    ) -> dict[str, Any]:
        spec = self._spec
        assert spec is not None
        return get_api_provider(spec.id).complete_structured(
            self._completion_request(purpose=purpose),
            prompt,
            schema,
            purpose=purpose,
        )

    def describe(self) -> dict[str, Any]:
        spec = self._spec
        target = self._http_target() if spec and self.configured() else None
        return {
            "id": "design-agent",
            "label": f"Design Agent ({spec.label})" if spec else "Design Agent",
            "provider": spec.id if spec else None,
            "package": spec.package if spec else None,
            "model": self._model() if spec else None,
            "base_url": target.openai_base_url() if target else None,
            "using_llm_fallback": self._using_llm_fallback,
            "ready": self.configured(),
            "configured": self.configured(),
            "error": self.init_error,
        }


def get_design_agent_engine(settings: Settings | None = None) -> DesignAgentEngine:
    return DesignAgentEngine(settings or get_settings())
