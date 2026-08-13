"""Claude via official ``langchain-anthropic`` (``ChatAnthropic``)."""

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import ConvertRequest, LangChainChatProvider, chat_kwargs


class AnthropicProvider(LangChainChatProvider):
    id = "claude"
    native_pdf = True

    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(**chat_kwargs(request))
