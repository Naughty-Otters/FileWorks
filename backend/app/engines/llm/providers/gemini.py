"""Gemini via official ``langchain-google-genai`` (``ChatGoogleGenerativeAI``)."""

from __future__ import annotations

import base64
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import CONVERT_PROMPT, ConvertRequest, LangChainChatProvider, openai_vision_parts


def gemini_thinking_kwargs(model: str) -> dict[str, Any]:
    """Turn thinking off so convert/translate return text instead of empty MAX_TOKENS.

    Gemini 2.5 defaults to dynamic thinking, which can spend the whole ``max_tokens``
    budget on thoughts (empty ``content``) and stall long enough that Cloudflare
    drops the request — the browser then reports that as CORS. Do not set
    ``thinking_level`` together with ``thinking_budget``: langchain-google-genai
    ignores the budget when both are present.
    """
    name = (model or "").lower()
    if "2.5" in name or name.startswith("gemini-2"):
        return {"thinking_budget": 0}
    return {"thinking_level": "minimal"}


class GeminiProvider(LangChainChatProvider):
    id = "gemini"
    native_pdf = True

    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(
            model=request.model,
            google_api_key=request.api_key,
            max_tokens=request.max_tokens,
            timeout=request.timeout_s,
            temperature=0,
            **gemini_thinking_kwargs(request.model),
        )

    def build_parts(self, request: ConvertRequest) -> list[dict[str, Any]]:
        if request.suffix != ".pdf":
            return openai_vision_parts(request)
        data = request.file_path.read_bytes()
        return [
            {"type": "text", "text": CONVERT_PROMPT},
            {
                "type": "file",
                "source_type": "base64",
                "mime_type": "application/pdf",
                "data": base64.b64encode(data).decode("ascii"),
            },
        ]
