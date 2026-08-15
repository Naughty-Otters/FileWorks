from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer

PUBLIC_ENGINE = "FileWorks"
_STACK_TOKENS = ("anydoc", "paddle", "firecrawl", "pp-ocr", "ppocr", "structurev3", "langchain")


def public_engine_name(_value: str | None) -> str:
    return PUBLIC_ENGINE


def public_error(value: str | None) -> str | None:
    if not value:
        return None
    lower = value.lower()
    if any(token in lower for token in _STACK_TOKENS):
        return "Unavailable"
    return value


class EngineInfo(BaseModel):
    id: str
    label: str
    ready: bool = False
    configured: bool = True
    active: bool = False
    error: str | None = None
    option_support: dict[str, str] = Field(default_factory=dict)

    @field_serializer("id")
    def _public_id(self, value: str) -> str:
        if value in {"anydoc", "ocr", "structure"}:
            return "document"
        if value == "llm":
            return "ai"
        return "document"

    @field_serializer("label")
    def _public_label(self, _value: str) -> str:
        return PUBLIC_ENGINE

    @field_serializer("error")
    def _public_error(self, value: str | None) -> str | None:
        return public_error(value)


class LLMFileProvider(BaseModel):
    """Catalog entry that can read images / PDFs via a vision or document model."""

    id: str
    label: str
    default_model: str
    native_pdf: bool = False
    key_env: str

    @field_serializer("id", "label", "default_model", "key_env")
    def _public_provider(self, _value: str) -> str:
        return "ai"


class TranslateLanguage(BaseModel):
    id: str
    label: str


class CancelRunResponse(BaseModel):
    run_id: str
    stopped: bool
    # Honest outcome: process killed vs cooperative token written for Lambda/pages.
    killed: bool = False
    token_written: bool = False
    detail: str


class HealthResponse(BaseModel):
    status: str
    app: str
    ocr_ready: bool
    ocr_engine: str | None = None
    ocr_error: str | None = None
    llm_ready: bool = False
    llm_provider: str | None = None
    llm_error: str | None = None
    llm_file_providers: list[LLMFileProvider] = Field(default_factory=list)
    translate_ready: bool = False
    translate_provider: str | None = None
    translate_error: str | None = None
    translate_languages: list[TranslateLanguage] = Field(default_factory=list)
    storage_backend: str | None = None
    direct_upload: bool = False
    engines: list[EngineInfo] = Field(default_factory=list)
    # Live conversion queue, so a waiting client can say so instead of guessing.
    converting: int = 0
    convert_waiting: int = 0
    convert_capacity: int = 0

    @field_serializer("ocr_engine")
    def _public_ocr_engine(self, _value: str | None) -> None:
        return None

    @field_serializer("llm_provider", "translate_provider")
    def _public_provider_name(self, value: str | None) -> str | None:
        return "AI" if value else None

    @field_serializer("ocr_error", "llm_error", "translate_error")
    def _public_health_error(self, value: str | None) -> str | None:
        return public_error(value)


class PresignUploadRequest(BaseModel):
    filename: str
    content_type: str | None = None
    size_bytes: int | None = None
    user_id: str


class PresignUploadResponse(BaseModel):
    upload_url: str
    object_key: str
    bucket: str
    method: str = "PUT"
    headers: dict[str, str] = Field(default_factory=dict)
    expires_in: int = 600


class HistoryFileUrlResponse(BaseModel):
    url: str
    filename: str
    content_type: str | None = None
    expires_in: int | None = None


class ExtractOptionsResponse(BaseModel):
    use_ai: bool = False
    prefer_structure: bool = False
    use_doc_preprocessor: bool = False
    use_seal_recognition: bool = False
    use_table_recognition: bool = True
    use_formula_recognition: bool = False
    use_chart_recognition: bool = False
    use_region_detection: bool = True
    format_block_content: bool = True
    target_lang: str = ""


class RegionBox(BaseModel):
    id: str
    page: int = 1
    label: str
    text: str = ""
    bbox: list[float]
    order: int | float | None = None
    score: float | None = None


class ImageSize(BaseModel):
    width: float
    height: float


class ExtractResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, ser_json_by_alias=True)

    id: str | None = None
    filename: str
    content_type: str | None = None
    size_bytes: int
    engine: str
    page_count: int
    format: Literal["markdown", "json", "both"]
    markdown: str | None = None
    data: Any | None = Field(
        default=None,
        serialization_alias="json",
        validation_alias="json",
        description="Structured JSON extraction result",
    )
    pages: list[dict[str, Any]] = Field(default_factory=list)
    created_at: str | None = None
    storage_backend: str | None = None
    options: ExtractOptionsResponse | None = None
    regions: list[RegionBox] = Field(default_factory=list)
    image_size: ImageSize | None = None

    @field_serializer("engine")
    def _public_engine(self, _value: str) -> str:
        return public_engine_name(_value)


class HistoryItem(BaseModel):
    id: str
    filename: str
    content_type: str | None = None
    size_bytes: int
    created_at: str
    engine: str | None = None
    page_count: int = 0
    storage_backend: str = "local"
    has_markdown: bool = False
    has_json: bool = False
    owner_id: str | None = None

    @field_serializer("engine")
    def _public_engine(self, _value: str | None) -> str | None:
        return public_engine_name(_value) if _value else None


class HistoryListResponse(BaseModel):
    items: list[HistoryItem]
    storage_backend: str


class HistoryDetailResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True, ser_json_by_alias=True)

    id: str
    filename: str
    content_type: str | None = None
    size_bytes: int
    created_at: str
    engine: str | None = None
    page_count: int = 0
    format: str = "both"
    markdown: str | None = None
    data: Any | None = Field(default=None, serialization_alias="json", validation_alias="json")
    pages: list[dict[str, Any]] = Field(default_factory=list)
    storage_backend: str = "local"
    file_url: str
    regions: list[RegionBox] = Field(default_factory=list)
    image_size: ImageSize | None = None
    options: ExtractOptionsResponse | None = None

    @field_serializer("engine")
    def _public_engine(self, _value: str | None) -> str | None:
        return public_engine_name(_value) if _value else None


class ErrorResponse(BaseModel):
    detail: str


class ExportRequest(BaseModel):
    markdown: str
    format: Literal["markdown", "md", "txt", "text", "html", "json"] = "markdown"
    filename: str | None = None
