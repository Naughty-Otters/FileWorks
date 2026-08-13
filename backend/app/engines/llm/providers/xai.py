"""Grok / xAI via official ``langchain-xai`` (``ChatXAI``)."""

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import ConvertRequest, LangChainChatProvider, chat_kwargs


class XAIProvider(LangChainChatProvider):
    id = "grok"

    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        from langchain_xai import ChatXAI

        return ChatXAI(**chat_kwargs(request))
