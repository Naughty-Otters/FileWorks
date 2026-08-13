"""OpenAI via official ``langchain-openai`` (``ChatOpenAI``)."""

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import ConvertRequest, LangChainChatProvider, chat_kwargs


class OpenAIProvider(LangChainChatProvider):
    id = "openai"

    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(**chat_kwargs(request))
