"""Vendor providers — each wraps an official LangChain Chat* class."""

from app.engines.llm.providers.anthropic import AnthropicProvider
from app.engines.llm.providers.base import (
    CONVERT_PROMPT,
    ConvertRequest,
    LLMApiProvider,
    LLMClientError,
    clean_markdown,
)
from app.engines.llm.providers.deepseek import DeepSeekProvider
from app.engines.llm.providers.fireworks import FireworksProvider
from app.engines.llm.providers.glm import GLMProvider
from app.engines.llm.providers.moonshot import MoonshotProvider
from app.engines.llm.providers.openai import OpenAIProvider
from app.engines.llm.providers.openrouter import OpenRouterProvider
from app.engines.llm.providers.xai import XAIProvider

API_PROVIDERS: dict[str, LLMApiProvider] = {
    provider.id: provider
    for provider in (
        DeepSeekProvider(),
        OpenAIProvider(),
        AnthropicProvider(),
        FireworksProvider(),
        XAIProvider(),
        OpenRouterProvider(),
        MoonshotProvider(),
        GLMProvider(),
    )
}


def get_api_provider(provider_id: str) -> LLMApiProvider:
    provider = API_PROVIDERS.get(provider_id)
    if provider is None:
        known = ", ".join(sorted(API_PROVIDERS))
        raise ValueError(f"Unknown LLM provider '{provider_id}'. Known: {known}")
    return provider


__all__ = [
    "API_PROVIDERS",
    "CONVERT_PROMPT",
    "ConvertRequest",
    "LLMApiProvider",
    "LLMClientError",
    "clean_markdown",
    "get_api_provider",
]
