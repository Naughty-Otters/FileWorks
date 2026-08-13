"""Fireworks via official ``langchain-fireworks`` (``ChatFireworks``)."""

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import ConvertRequest, LangChainChatProvider, chat_kwargs


class FireworksProvider(LangChainChatProvider):
    id = "fireworks"

    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        from langchain_fireworks import ChatFireworks

        return ChatFireworks(**chat_kwargs(request))
