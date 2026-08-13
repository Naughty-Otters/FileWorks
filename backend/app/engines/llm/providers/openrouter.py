"""OpenRouter via official ``langchain-openrouter`` (``ChatOpenRouter``)."""

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import ConvertRequest, LangChainChatProvider, chat_kwargs


class OpenRouterProvider(LangChainChatProvider):
    id = "openrouter"

    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        from langchain_openrouter import ChatOpenRouter

        return ChatOpenRouter(
            **chat_kwargs(
                request,
                timeout_is_ms=True,
                extra={
                    "app_title": "FileWorks",
                    "app_url": "https://github.com/fileworks",
                },
            )
        )
