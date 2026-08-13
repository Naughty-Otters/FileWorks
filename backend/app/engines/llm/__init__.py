"""LLM document engines — official LangChain Chat* packages per vendor."""

from app.engines.llm.catalog import (
    PROVIDERS,
    get_provider_spec,
    list_vision_providers,
    resolve_provider_id,
)
from app.engines.llm.engine import LLMEngine
from app.engines.llm.providers import API_PROVIDERS, get_api_provider

__all__ = [
    "API_PROVIDERS",
    "LLMEngine",
    "PROVIDERS",
    "get_api_provider",
    "get_provider_spec",
    "list_vision_providers",
    "resolve_provider_id",
]
