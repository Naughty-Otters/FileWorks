"""Gemini via official ``langchain-google-genai`` (``ChatGoogleGenerativeAI``)."""

from __future__ import annotations

import base64
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel

from app.engines.llm.providers.base import CONVERT_PROMPT, ConvertRequest, LangChainChatProvider, openai_vision_parts


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
