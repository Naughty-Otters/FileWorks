from typing import Any

from pydantic import BaseModel, Field, field_serializer

from app.api.schemas import public_engine_name


class ConvertInputGroup(BaseModel):
    id: str
    label: str
    extensions: list[str]


class ConvertTarget(BaseModel):
    id: str
    label: str
    aliases: list[str] = Field(default_factory=list)
    media_type: str | None = None
    extension: str | None = None
    available: bool = True
    unavailable_reason: str | None = None


class ConvertOption(BaseModel):
    name: str
    type: str
    label: str
    description: str
    default: Any = None
    values: list[str] | None = None
    available: bool = True
    allowed: bool = True
    unavailable_reason: str | None = None


class ConvertCapabilities(BaseModel):
    ai: bool
    translate: bool


class ConvertLanguage(BaseModel):
    id: str
    label: str


class ConvertCredits(BaseModel):
    standard_per_page: int = 1
    ai_per_page: int = 3
    used: int | None = None
    limit: int | None = None
    remaining: int | None = None


class ConvertCatalogResponse(BaseModel):
    """What POST /api/v1/convert accepts right now."""

    max_upload_mb: int
    plan: str | None = None
    api_plan: str | None = None
    inputs: list[ConvertInputGroup]
    input_extensions: list[str]
    targets: list[ConvertTarget]
    languages: list[ConvertLanguage]
    options: list[ConvertOption]
    capabilities: ConvertCapabilities
    credits: ConvertCredits | None = None
    pipeline: dict[str, Any] | None = None
    designs: list[dict[str, Any]] = Field(default_factory=list)


class ConvertSource(BaseModel):
    filename: str
    extension: str
    content_type: str | None = None
    size_bytes: int


class ConvertAppliedOptions(BaseModel):
    use_ai: bool = False
    prefer_structure: bool = False
    preserve_images: bool = True
    ocr_high_quality: bool = False
    use_doc_preprocessor: bool = False
    use_seal_recognition: bool = False
    use_table_recognition: bool = True
    use_formula_recognition: bool = False
    use_chart_recognition: bool = False
    use_region_detection: bool = True
    format_block_content: bool = True
    target_lang: str = ""


class ConvertResponse(BaseModel):
    id: str
    source: ConvertSource
    target: str
    filename: str
    media_type: str
    markdown: str
    content: str
    content_encoding: str = "utf-8"
    options: ConvertAppliedOptions
    engine: str
    page_count: int
    credits_used: int = 0
    design: str | None = None
    design_fill: str | None = None

    @field_serializer("engine")
    def _public_engine(self, _value: str) -> str:
        return public_engine_name(_value)
