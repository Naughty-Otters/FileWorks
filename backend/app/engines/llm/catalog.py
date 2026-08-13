"""Named LLM vendors and their official LangChain packages."""

from __future__ import annotations

from pydantic.dataclasses import dataclass


@dataclass(frozen=True)
class LLMProviderSpec:
    id: str
    label: str
    package: str  # PyPI / import package, e.g. langchain-deepseek
    base_url: str
    default_model: str
    # Settings field names tried in order for the API key.
    key_fields: tuple[str, ...]
    # Native PDF as a document part (Anthropic). Others rasterize pages.
    native_pdf: bool = False
    # Whether this vendor's default hosted API accepts images / files.
    supports_vision: bool = True


PROVIDERS: dict[str, LLMProviderSpec] = {
    "openrouter": LLMProviderSpec(
        id="openrouter",
        label="OpenRouter",
        package="langchain-openrouter",
        base_url="https://openrouter.ai/api/v1",
        default_model="openai/gpt-4o-mini",
        key_fields=("openrouter_api_key",),
    ),
    "fireworks": LLMProviderSpec(
        id="fireworks",
        label="Fireworks",
        package="langchain-fireworks",
        base_url="https://api.fireworks.ai/inference/v1",
        default_model="accounts/fireworks/models/llama-v3p2-11b-vision-instruct",
        key_fields=("fireworks_api_key",),
    ),
    "deepseek": LLMProviderSpec(
        id="deepseek",
        label="DeepSeek",
        package="langchain-deepseek",
        # Hosted chat is text-only. Override with DEEPSEEK_BASE_URL / LLM_BASE_URL
        # for a vision or OCR-compatible host that ChatDeepSeek can call.
        base_url="https://api.deepseek.com/v1",
        default_model="deepseek-chat",
        key_fields=("deepseek_api_key",),
        supports_vision=False,
    ),
    "kimi": LLMProviderSpec(
        id="kimi",
        label="Kimi",
        package="langchain-moonshot",
        base_url="https://api.moonshot.ai/v1",
        default_model="kimi-k2.5",
        key_fields=("kimi_api_key", "moonshot_api_key"),
    ),
    "glm": LLMProviderSpec(
        id="glm",
        label="GLM",
        package="langchain-openai",  # no partner package; OpenAI-compatible API
        base_url="https://open.bigmodel.cn/api/paas/v4",
        default_model="glm-4.5v",
        key_fields=("glm_api_key", "zhipu_api_key"),
    ),
    "openai": LLMProviderSpec(
        id="openai",
        label="OpenAI",
        package="langchain-openai",
        base_url="https://api.openai.com/v1",
        default_model="gpt-4o",
        key_fields=("openai_api_key",),
    ),
    "grok": LLMProviderSpec(
        id="grok",
        label="Grok",
        package="langchain-xai",
        base_url="https://api.x.ai/v1",
        default_model="grok-2-vision-1212",
        key_fields=("grok_api_key", "xai_api_key"),
    ),
    "claude": LLMProviderSpec(
        id="claude",
        label="Claude",
        package="langchain-anthropic",
        base_url="https://api.anthropic.com",
        default_model="claude-sonnet-4-5",
        key_fields=("anthropic_api_key", "claude_api_key"),
        native_pdf=True,
    ),
}

ALIASES: dict[str, str] = {
    "kimi3": "kimi",
    "kimi-k2": "kimi",
    "moonshot": "kimi",
    "zhipu": "glm",
    "zhipuai": "glm",
    "bigmodel": "glm",
    "anthropic": "claude",
    "xai": "grok",
    "glok": "grok",
    "chatgpt": "openai",
    "or": "openrouter",
}


def resolve_provider_id(value: str | None) -> str | None:
    if not value:
        return None
    key = value.strip().lower()
    if not key:
        return None
    return ALIASES.get(key, key)


def get_provider_spec(provider_id: str | None) -> LLMProviderSpec:
    resolved = resolve_provider_id(provider_id)
    if not resolved or resolved not in PROVIDERS:
        known = ", ".join(sorted(PROVIDERS))
        raise ValueError(f"Unknown LLM provider '{provider_id}'. Known: {known}")
    return PROVIDERS[resolved]


def list_vision_providers() -> list[LLMProviderSpec]:
    """Vendors whose hosted API can take images / files (not text-only chat)."""
    return [spec for spec in PROVIDERS.values() if spec.supports_vision]
