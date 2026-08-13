"""DeepSeek via official ``langchain-deepseek`` (``ChatDeepSeek``)."""

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import ConvertRequest, LangChainChatProvider, chat_kwargs


class DeepSeekProvider(LangChainChatProvider):
    id = "deepseek"

    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        from langchain_deepseek import ChatDeepSeek

        return ChatDeepSeek(**chat_kwargs(request))
