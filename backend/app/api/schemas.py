from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class EngineInfo(BaseModel):
    id: str
    label: str
    ready: bool = False
    configured: bool = True
    active: bool = False
    error: str | None = None
    option_support: dict[str, str] = Field(default_factory=dict)


class LLMFileProvider(BaseModel):
    """Catalog entry that can read images / PDFs via a vision or document model."""

    id: str
    label: str
    default_model: str
    native_pdf: bool = False
    key_env: str


class TranslateLanguage(BaseModel):
    id: str
    label: str


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


class ExtractOptionsResponse(BaseModel):
    use_ai: bool = False
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


class ErrorResponse(BaseModel):
    detail: str


class ExportRequest(BaseModel):
    markdown: str
    format: Literal["markdown", "md", "txt", "text", "html", "json"] = "markdown"
    filename: str | None = None
