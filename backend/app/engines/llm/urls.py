"""Resolve API base URLs for official LangChain Chat clients."""

from __future__ import annotations

from urllib.parse import urlparse

from pydantic.dataclasses import dataclass

from app.core.config import Settings
from app.engines.llm.catalog import LLMProviderSpec

CHAT_COMPLETIONS_SUFFIX = "/chat/completions"
HOSTED_DEEPSEEK_NETLOCS = {"api.deepseek.com"}


@dataclass(frozen=True)
class LLMHttpTarget:
    """API root passed to the LangChain client as ``base_url`` / ``api_base``."""

    base_url: str

    def openai_base_url(self) -> str:
        return self.base_url.rstrip("/")


def normalize_base_url(url: str) -> str:
    cleaned = url.strip().rstrip("/")
    if cleaned.endswith(CHAT_COMPLETIONS_SUFFIX):
        return cleaned[: -len(CHAT_COMPLETIONS_SUFFIX)].rstrip("/")
    return cleaned


def resolve_http_target(
    settings: Settings,
    spec: LLMProviderSpec,
    *,
    endpoint: str | None = None,
    base_url: str | None = None,
    include_llm_overrides: bool = True,
) -> LLMHttpTarget:
    """
    Priority:
    1. Explicit endpoint / LLM_ENDPOINT (full URL; ``/chat/completions`` suffix is stripped)
    2. Explicit base_url / LLM_BASE_URL
    3. Provider-specific ``{id}_base_url`` (e.g. DEEPSEEK_BASE_URL)
    4. Catalog default
    """
    chosen_endpoint = (endpoint or "").strip()
    if not chosen_endpoint and include_llm_overrides:
        chosen_endpoint = (settings.llm_endpoint or "").strip()
    if chosen_endpoint:
        return LLMHttpTarget(base_url=normalize_base_url(chosen_endpoint))

    chosen_base = (base_url or "").strip()
    if not chosen_base and include_llm_overrides:
        chosen_base = (settings.llm_base_url or "").strip()
    if chosen_base:
        return LLMHttpTarget(base_url=normalize_base_url(chosen_base))

    field = f"{spec.id}_base_url"
    provider_url = getattr(settings, field, None)
    if isinstance(provider_url, str) and provider_url.strip():
        return LLMHttpTarget(base_url=normalize_base_url(provider_url))

    return LLMHttpTarget(base_url=spec.base_url.rstrip("/"))


def is_hosted_deepseek(base_url: str) -> bool:
    host = urlparse(base_url).netloc.lower()
    return host in HOSTED_DEEPSEEK_NETLOCS or host.endswith(".deepseek.com")


def supports_file_input(spec: LLMProviderSpec, base_url: str) -> bool:
    """Hosted DeepSeek chat is text-only; a custom DeepSeek-OCR host can take images."""
    if spec.id == "deepseek":
        return not is_hosted_deepseek(base_url)
    return spec.supports_vision
