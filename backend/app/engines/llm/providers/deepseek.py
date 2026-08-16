"""DeepSeek via official ``langchain-deepseek`` (``ChatDeepSeek``)."""

from __future__ import annotations

from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import ConvertRequest, LangChainChatProvider, chat_kwargs


def deepseek_thinking_extra(model: str) -> dict[str, Any] | None:
    """Disable thinking on V4 / reasoner models so ``content`` is not left empty."""
    name = (model or "").lower()
    if any(token in name for token in ("v4", "reasoner", "-r1", "r1-")):
        return {"extra_body": {"thinking": {"type": "disabled"}}}
    return None


class DeepSeekProvider(LangChainChatProvider):
    id = "deepseek"

    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        from langchain_deepseek import ChatDeepSeek

        return ChatDeepSeek(**chat_kwargs(request, extra=deepseek_thinking_extra(request.model)))
