"""GLM / Zhipu — no LangChain partner package; OpenAI-compatible ``ChatOpenAI``."""

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import ConvertRequest, LangChainChatProvider, chat_kwargs


class GLMProvider(LangChainChatProvider):
    """Zhipu documents an OpenAI-compatible API; there is no ``langchain-glm`` partner pkg."""

    id = "glm"

    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(**chat_kwargs(request))
