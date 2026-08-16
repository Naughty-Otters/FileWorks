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

    def complete_text(
        self,
        request: ConvertRequest,
        prompt: str,
        *,
        purpose: str = "text",
        part: str | None = None,
    ) -> str:
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
            return [
                invoke_markdown(
                    model,
                    self.build_parts(request),
                    request=request,
                    purpose="convert",
                    part="1/1",
                )
            ]
        blobs = image_blobs(request)
        if len(blobs) <= 1:
            return [
                invoke_markdown(
                    model,
                    self.build_parts(request),
                    request=request,
                    purpose="convert",
                    part="1/1",
                )
            ]
        pages: list[str] = []
        total = len(blobs)
        for index, (data, media_type) in enumerate(blobs, start=1):
            check_cancelled(where=f"LLM page {index}/{total}")
            prompt = f"{CONVERT_PROMPT} This is source page {index} of {total}."
            pages.append(
                invoke_markdown(
                    model,
                    _single_image_parts(prompt, data, media_type),
                    request=request,
                    purpose="convert",
                    part=f"{index}/{total}",
                )
            )
        return pages

    def complete_text(
        self,
        request: ConvertRequest,
        prompt: str,
        *,
        purpose: str = "text",
        part: str | None = None,
    ) -> str:
        model = self.build_chat_model(request)
        logger.info(
            "LLM text invoke provider=%s package=%s model=%s base_url=%s",
            request.spec.id,
            request.spec.package,
            request.model,
            request.target.openai_base_url(),
        )
        return invoke_markdown(
            model,
            [{"type": "text", "text": prompt}],
            request=request,
            purpose=purpose,
            part=part,
        )

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


LLM_TOKENS_TAG = "[LLM_TOKENS]"


def extract_token_usage(response: object) -> dict[str, int | None]:
    """Normalize LangChain / vendor token counts into a stable dict."""
    usage_meta = _as_mapping(getattr(response, "usage_metadata", None))
    response_meta = _as_mapping(getattr(response, "response_metadata", None))
    extras = _as_mapping(getattr(response, "additional_kwargs", None))
    openai_usage = _as_mapping(
        response_meta.get("token_usage")
        or response_meta.get("usage")
        or extras.get("usage")
    )
    gemini_usage = _as_mapping(
        response_meta.get("usage_metadata") or extras.get("usage_metadata")
    )
    input_details = _as_mapping(
        usage_meta.get("input_token_details")
        or openai_usage.get("prompt_tokens_details")
        or gemini_usage.get("prompt_tokens_details")
    )
    output_details = _as_mapping(
        usage_meta.get("output_token_details")
        or openai_usage.get("completion_tokens_details")
        or gemini_usage.get("completion_tokens_details")
    )
    input_tokens = _first_int(
        usage_meta.get("input_tokens"),
        openai_usage.get("prompt_tokens"),
        gemini_usage.get("prompt_token_count"),
        gemini_usage.get("prompt_tokens"),
    )
    output_tokens = _first_int(
        usage_meta.get("output_tokens"),
        openai_usage.get("completion_tokens"),
        gemini_usage.get("candidates_token_count"),
        gemini_usage.get("candidates_tokens"),
    )
    thinking = _first_int(
        output_details.get("reasoning"),
        output_details.get("reasoning_tokens"),
        gemini_usage.get("thoughts_token_count"),
        openai_usage.get("reasoning_tokens"),
        usage_meta.get("reasoning_tokens"),
    )
    cached = _first_int(
        input_details.get("cache_read"),
        input_details.get("cached_tokens"),
        openai_usage.get("cached_tokens"),
        gemini_usage.get("cached_content_token_count"),
    )
    total = _first_int(
        usage_meta.get("total_tokens"),
        openai_usage.get("total_tokens"),
        gemini_usage.get("total_token_count"),
    )
    if total is None:
        parts = [value for value in (input_tokens, output_tokens, thinking) if value is not None]
        if parts:
            total = sum(parts)
    return {
        "input": input_tokens,
        "output": output_tokens,
        "thinking": thinking,
        "cached": cached,
        "total": total,
    }


def format_llm_tokens_line(
    *,
    provider: str | None,
    model: str | None,
    purpose: str,
    usage: dict[str, int | None],
    out_chars: int,
    part: str | None = None,
    finish_reason: str | None = None,
) -> str:
    fields = [
        f"provider={provider or '-'}",
        f"model={model or '-'}",
        f"purpose={purpose}",
    ]
    if part:
        fields.append(f"part={part}")
    fields.extend(
        [
            f"input={_fmt_count(usage.get('input'))}",
            f"output={_fmt_count(usage.get('output'))}",
            f"thinking={_fmt_count(usage.get('thinking'))}",
            f"cached={_fmt_count(usage.get('cached'))}",
            f"total={_fmt_count(usage.get('total'))}",
            f"out_chars={out_chars}",
        ]
    )
    if finish_reason:
        fields.append(f"finish={finish_reason}")
    return f"{LLM_TOKENS_TAG}  " + "  ".join(fields)


def log_llm_tokens(
    response: object,
    *,
    request: ConvertRequest | None,
    chat_model: object,
    purpose: str,
    part: str | None,
    out_chars: int,
) -> None:
    provider = request.spec.id if request else None
    model_name = (request.model if request else None) or _chat_model_name(chat_model)
    meta = _as_mapping(getattr(response, "response_metadata", None))
    finish = meta.get("finish_reason") or meta.get("stop_reason") or meta.get("finishReason")
    line = format_llm_tokens_line(
        provider=provider,
        model=model_name,
        purpose=purpose,
        usage=extract_token_usage(response),
        out_chars=out_chars,
        part=part,
        finish_reason=str(finish) if finish else None,
    )
    logger.info("%s", line)


def _chat_model_name(chat_model: object) -> str | None:
    for attr in ("model", "model_name", "model_id"):
        value = getattr(chat_model, attr, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _as_mapping(value: object) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    dump = getattr(value, "model_dump", None)
    if callable(dump):
        try:
            dumped = dump()
            if isinstance(dumped, dict):
                return dumped
        except Exception:  # noqa: BLE001
            pass
    items = getattr(value, "items", None)
    if callable(items):
        try:
            return dict(items())
        except Exception:  # noqa: BLE001
            pass
    return {}


def _first_int(*values: object) -> int | None:
    for value in values:
        parsed = _as_int(value)
        if parsed is not None:
            return parsed
    return None


def _as_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _fmt_count(value: int | None) -> str:
    return "-" if value is None else str(value)


def invoke_markdown(
    model: BaseChatModel,
    parts: list[dict[str, Any]],
    *,
    request: ConvertRequest | None = None,
    purpose: str = "convert",
    part: str | None = None,
) -> str:
    message = HumanMessage(content=parts)
    try:
        response = model.invoke([message])
    except Exception as exc:  # noqa: BLE001
        raise LLMClientError(str(exc)) from exc
    text = _message_text(response)
    log_llm_tokens(
        response,
        request=request,
        chat_model=model,
        purpose=purpose,
        part=part,
        out_chars=len(text.strip()),
    )
    if not text.strip():
        raise _empty_content_error(response)
    return text


def clean_markdown(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:markdown|md)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    return cleaned.strip()


_SKIP_PART_TYPES = {
    "thinking",
    "thought",
    "reasoning",
    "executable_code",
    "code_execution_result",
}


def _empty_content_error(response: object) -> LLMClientError:
    meta = getattr(response, "response_metadata", None) or {}
    if not isinstance(meta, dict):
        meta = {}
    reason = meta.get("finish_reason") or meta.get("stop_reason") or meta.get("finishReason")
    detail = "LangChain chat model returned empty content"
    if reason:
        detail = f"{detail} (finish_reason={reason})"
    if str(reason).upper() in {"MAX_TOKENS", "LENGTH"}:
        detail += "; the model spent its token budget on thinking"
    if str(reason).upper() in {"SAFETY", "BLOCKLIST", "PROHIBITED_CONTENT"}:
        detail += "; the provider blocked the response"
    logger.warning("%s metadata=%s", detail, meta or None)
    return LLMClientError(detail)


def _message_text(message: BaseMessage) -> str:
    content = message.content if isinstance(message, AIMessage) else getattr(message, "content", "")
    text = _content_to_text(content)
    if text.strip():
        return text
    extras = getattr(message, "additional_kwargs", None) or {}
    if isinstance(extras, dict):
        for key in ("text", "output_text"):
            value = extras.get(key)
            if isinstance(value, str) and value.strip():
                return value
    return text


def _content_to_text(content: object) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, str):
                chunks.append(item)
            elif isinstance(item, dict):
                part_type = str(item.get("type") or "").lower()
                if part_type in _SKIP_PART_TYPES:
                    continue
                chunks.append(str(item.get("text") or ""))
        return "".join(chunks)
    return str(content or "")
