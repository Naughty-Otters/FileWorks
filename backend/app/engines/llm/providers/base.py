"""Shared LangChain chat helpers. Vendor modules wrap official Chat* classes."""

from __future__ import annotations

import base64
import logging
import re
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any

from pydantic.dataclasses import dataclass

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from app.engines.llm.catalog import LLMProviderSpec
from app.engines.llm.media import IMAGE_SUFFIXES, encode_image_file, render_pdf_pages
from app.engines.llm.urls import LLMHttpTarget
from app.services.pages import PAGE_SEPARATOR

logger = logging.getLogger(__name__)

CONVERT_PROMPT = (
    "Convert this document to clean GitHub-Flavored Markdown. "
    "Output Markdown only — no preamble, no explanation, no code fences around the whole document. "
    "Preserve headings, lists, tables, emphasis, and reading order. "
    "Transcribe all visible text. Use GFM pipe tables. "
    "If a region is a picture (not text), add a short italic caption."
)


class LLMClientError(RuntimeError):
    """Raised when a chat model returns an error or empty content."""


@dataclass(frozen=True)
class ConvertRequest:
    spec: LLMProviderSpec
    file_path: Path
    suffix: str
    api_key: str
    model: str
    max_tokens: int
    timeout_s: float
    target: LLMHttpTarget
    max_pages: int
    max_image_side: int


class LLMApiProvider(ABC):
    """One named vendor, backed by its official LangChain Chat class."""

    id: str

    @abstractmethod
    def convert(self, request: ConvertRequest) -> str:
        """Send the document and return Markdown text."""

    def convert_pages(self, request: ConvertRequest) -> list[str]:
        """Convert one Markdown string per source page when the backend can split."""
        return [self.convert(request)]

    def complete_text(self, request: ConvertRequest, prompt: str) -> str:
        """Text-only completion (translation and other post-process steps)."""
        raise NotImplementedError


class LangChainChatProvider(LLMApiProvider):
    """Build an official Chat* model, then invoke with vision / document parts."""

    native_pdf: bool = False

    def convert(self, request: ConvertRequest) -> str:
        return PAGE_SEPARATOR.join(part for part in self.convert_pages(request) if part.strip()).strip()

    def convert_pages(self, request: ConvertRequest) -> list[str]:
        from app.services.cancel_token import check_cancelled

        check_cancelled(where="LLM start")
        model = self.build_chat_model(request)
        logger.info(
            "LLM invoke provider=%s package=%s model=%s base_url=%s",
            request.spec.id,
            request.spec.package,
            request.model,
            request.target.openai_base_url(),
        )
        if self.native_pdf and request.suffix == ".pdf":
            return [invoke_markdown(model, self.build_parts(request))]
        blobs = image_blobs(request)
        if len(blobs) <= 1:
            return [invoke_markdown(model, self.build_parts(request))]
        pages: list[str] = []
        total = len(blobs)
        for index, (data, media_type) in enumerate(blobs, start=1):
            check_cancelled(where=f"LLM page {index}/{total}")
            prompt = f"{CONVERT_PROMPT} This is source page {index} of {total}."
            pages.append(invoke_markdown(model, _single_image_parts(prompt, data, media_type)))
        return pages

    def complete_text(self, request: ConvertRequest, prompt: str) -> str:
        model = self.build_chat_model(request)
        logger.info(
            "LLM text invoke provider=%s package=%s model=%s base_url=%s",
            request.spec.id,
            request.spec.package,
            request.model,
            request.target.openai_base_url(),
        )
        return invoke_markdown(model, [{"type": "text", "text": prompt}])

    @abstractmethod
    def build_chat_model(self, request: ConvertRequest) -> BaseChatModel:
        """Return the vendor's official LangChain chat model."""

    def build_parts(self, request: ConvertRequest) -> list[dict[str, Any]]:
        if self.native_pdf:
            return anthropic_document_parts(request)
        return openai_vision_parts(request)


def chat_kwargs(
    request: ConvertRequest,
    *,
    timeout_is_ms: bool = False,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    timeout: float | int = request.timeout_s
    if timeout_is_ms:
        timeout = int(request.timeout_s * 1000)
    kwargs: dict[str, Any] = {
        "model": request.model,
        "api_key": request.api_key,
        "base_url": request.target.openai_base_url(),
        "max_tokens": request.max_tokens,
        "timeout": timeout,
        "temperature": 0,
    }
    if extra:
        kwargs.update(extra)
    return kwargs


def image_blobs(request: ConvertRequest) -> list[tuple[bytes, str]]:
    suffix = request.suffix
    if suffix in IMAGE_SUFFIXES:
        return [encode_image_file(request.file_path, max_side=request.max_image_side)]
    if suffix == ".pdf":
        return render_pdf_pages(
            request.file_path,
            max_pages=request.max_pages,
            max_side=request.max_image_side,
        )
    raise RuntimeError(f"LLM engine does not handle {suffix}")


def openai_vision_parts(request: ConvertRequest) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = [{"type": "text", "text": CONVERT_PROMPT}]
    for data, media_type in image_blobs(request):
        parts.extend(_image_url_parts(data, media_type))
    return parts


def _single_image_parts(prompt: str, data: bytes, media_type: str) -> list[dict[str, Any]]:
    return [{"type": "text", "text": prompt}, *_image_url_parts(data, media_type)]


def _image_url_parts(data: bytes, media_type: str) -> list[dict[str, Any]]:
    b64 = base64.b64encode(data).decode("ascii")
    return [
        {
            "type": "image_url",
            "image_url": {"url": f"data:{media_type};base64,{b64}"},
        }
    ]


def anthropic_document_parts(request: ConvertRequest) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = [{"type": "text", "text": CONVERT_PROMPT}]
    if request.suffix == ".pdf":
        data = request.file_path.read_bytes()
        parts.append(
            {
                "type": "document",
                "source": {
                    "type": "base64",
                    "media_type": "application/pdf",
                    "data": base64.b64encode(data).decode("ascii"),
                },
            }
        )
        return parts
    for data, media_type in image_blobs(request):
        parts.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64.b64encode(data).decode("ascii"),
                },
            }
        )
    return parts


def invoke_markdown(model: BaseChatModel, parts: list[dict[str, Any]]) -> str:
    message = HumanMessage(content=parts)
    try:
        response = model.invoke([message])
    except Exception as exc:  # noqa: BLE001
        raise LLMClientError(str(exc)) from exc
    text = _message_text(response)
    if not text.strip():
        raise LLMClientError("LangChain chat model returned empty content")
    return text


def clean_markdown(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:markdown|md)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


def _message_text(message: BaseMessage) -> str:
    content = message.content if isinstance(message, AIMessage) else getattr(message, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, str):
                chunks.append(item)
            elif isinstance(item, dict) and item.get("type") in {"text", "output_text"}:
                chunks.append(str(item.get("text") or ""))
        return "".join(chunks)
    return str(content or "")
