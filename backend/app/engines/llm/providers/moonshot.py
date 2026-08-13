"""Kimi / Moonshot via official ``langchain-moonshot`` (``ChatMoonshot``)."""

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import ConvertRequest, LangChainChatProvider, chat_kwargs


class MoonshotProvider(LangChainChatProvider):
    id = "kimi"

    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        from langchain_moonshot import ChatMoonshot

        return ChatMoonshot(**chat_kwargs(request))
