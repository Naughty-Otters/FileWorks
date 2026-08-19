"""Deploy-time pipeline spec: stages, readers, and OCR backends.

Enable/disable lives here. Per-request ``ExtractOptions`` (use_ai, preserve_images,
prefer_structure, …) overlay this spec and cannot turn on a disabled engine.

Build from ``Settings`` so existing env flags keep working:

    PADDLE_OCR_ENABLED, LITEPARSE_ENABLED, EASYOCR_ENABLED, SURYA_ENABLED,
    ANYDOC_ENABLED, DOCLING_ENABLED, TEXT_READER_ENABLED, LLM_READER_ENABLED,
    PIPELINE_*_ENABLED
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings

Kind = Literal["stage", "reader", "ocr"]


class PipelineItem(BaseModel):
    """One named step or engine, with its own enable flag and knobs."""

    id: str
    kind: Kind
    label: str
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)


class PipelineSpec(BaseModel):
    """Ordered lists the convert pipeline consults at runtime."""

    stages: list[PipelineItem]
    readers: list[PipelineItem]
    ocr_backends: list[PipelineItem]

    def item(self, group: Literal["stages", "readers", "ocr_backends"], item_id: str) -> PipelineItem | None:
        for item in getattr(self, group):
            if item.id == item_id:
                return item
        return None

    def stage_enabled(self, stage_id: str) -> bool:
        item = self.item("stages", stage_id)
        return True if item is None else bool(item.enabled)

    def reader_enabled(self, reader_id: str) -> bool:
        item = self.item("readers", reader_id)
        return False if item is None else bool(item.enabled)

    def ocr_backend_enabled(self, backend_id: str) -> bool:
        item = self.item("ocr_backends", backend_id)
        return False if item is None else bool(item.enabled)

    def reader_disabled_reason(self, reader_id: str) -> str | None:
        item = self.item("readers", reader_id)
        if item is None:
            return f"Unknown reader '{reader_id}'"
        if item.enabled:
            return None
        return f"{item.label} is disabled"

    def to_public_dict(self) -> dict[str, Any]:
        """JSON for catalog / health. No secrets."""
        return {
            "stages": [item.model_dump(mode="json") for item in self.stages],
            "readers": [item.model_dump(mode="json") for item in self.readers],
            "ocr_backends": [item.model_dump(mode="json") for item in self.ocr_backends],
        }

    @classmethod
    def from_settings(cls, settings: Settings | None = None) -> PipelineSpec:
        settings = settings or get_settings()
        return cls(
            stages=_stages_from_settings(settings),
            readers=_readers_from_settings(settings),
            ocr_backends=_ocr_backends_from_settings(settings),
        )


def get_pipeline_spec(settings: Settings | None = None) -> PipelineSpec:
    return PipelineSpec.from_settings(settings)


def _stages_from_settings(settings: Settings) -> list[PipelineItem]:
    return [
        PipelineItem(
            id="prepare_ocr_input",
            kind="stage",
            label="Prepare OCR input",
            enabled=settings.pipeline_prepare_ocr_enabled,
            config={
                "max_input_side_default": settings.ocr_max_input_side_default,
                "max_input_side_high": settings.ocr_max_input_side_high,
                "platform_max_input_side": settings.ocr_platform_max_input_side,
            },
        ),
        PipelineItem(
            id="read",
            kind="stage",
            label="Read",
            enabled=True,
            config={},
        ),
        PipelineItem(
            id="media",
            kind="stage",
            label="Embed media",
            enabled=settings.pipeline_media_enabled,
            config={},
        ),
        PipelineItem(
            id="structure_edit",
            kind="stage",
            label="LLM structure edit",
            enabled=settings.pipeline_structure_edit_enabled,
            config={},
        ),
        PipelineItem(
            id="translate",
            kind="stage",
            label="Translate",
            enabled=settings.pipeline_translate_enabled,
            config={
                "provider": settings.translate_provider,
                "model": settings.translate_model,
                "max_tokens": settings.translate_max_tokens,
                "timeout_s": settings.translate_timeout_s,
                "chunk_chars": settings.translate_chunk_chars,
            },
        ),
        PipelineItem(
            id="normalize",
            kind="stage",
            label="Normalize structure",
            enabled=settings.pipeline_normalize_enabled,
            config={},
        ),
        PipelineItem(
            id="fill",
            kind="stage",
            label="Fill structure",
            enabled=settings.pipeline_fill_enabled,
            config={},
        ),
        PipelineItem(
            id="project",
            kind="stage",
            label="Project markdown",
            enabled=settings.pipeline_project_enabled,
            config={},
        ),
        PipelineItem(
            id="export",
            kind="stage",
            label="Export",
            enabled=True,
            config={},
        ),
    ]


def _readers_from_settings(settings: Settings) -> list[PipelineItem]:
    return [
        PipelineItem(
            id="text",
            kind="reader",
            label="Text",
            enabled=settings.text_reader_enabled,
            config={"priority": 5},
        ),
        PipelineItem(
            id="docling",
            kind="reader",
            label="Docling",
            enabled=settings.docling_enabled,
            config={
                "priority": 8,
                "artifacts_path": settings.docling_artifacts_path,
            },
        ),
        PipelineItem(
            id="anydoc",
            kind="reader",
            label="AnyDoc",
            enabled=settings.anydoc_enabled,
            config={"priority": 10},
        ),
        PipelineItem(
            id="llm",
            kind="reader",
            label="LLM",
            enabled=settings.llm_reader_enabled,
            config={
                "priority": settings.llm_priority,
                "priority_fallback": settings.llm_priority_fallback,
                "provider": settings.llm_provider,
                "model": settings.llm_model,
                "max_pages": settings.llm_max_pages,
                "max_tokens": settings.llm_max_tokens,
                "timeout_s": settings.llm_timeout_s,
                "max_image_side": settings.llm_max_image_side,
            },
        ),
        PipelineItem(
            id="liteparse",
            kind="reader",
            label="LiteParse",
            enabled=settings.liteparse_enabled,
            config={
                "priority": settings.liteparse_priority,
                "dpi": settings.liteparse_dpi,
                "ocr_language": settings.liteparse_ocr_language,
                "use_paddle_ocr": settings.liteparse_use_paddle_ocr,
                "route_by_complexity": settings.liteparse_route_by_complexity,
            },
        ),
        PipelineItem(
            id="ocr",
            kind="reader",
            label="OCR",
            enabled=settings.paddle_ocr_enabled,
            config={"priority": 50, "engine": settings.ocr_engine},
        ),
    ]


def _ocr_backends_from_settings(settings: Settings) -> list[PipelineItem]:
    return [
        PipelineItem(
            id="tesseract",
            kind="ocr",
            label="Tesseract",
            enabled=True,
            config={"via": "liteparse"},
        ),
        PipelineItem(
            id="easyocr",
            kind="ocr",
            label="EasyOCR",
            enabled=settings.easyocr_enabled,
            config={
                "use_gpu": settings.easyocr_use_gpu,
                "model_dir": settings.easyocr_model_dir,
            },
        ),
        PipelineItem(
            id="paddle",
            kind="ocr",
            label="Paddle",
            enabled=settings.paddle_ocr_enabled,
            config={
                "device": settings.paddle_device,
                "engine": settings.ocr_engine,
                "enable_mkldnn": settings.paddle_enable_mkldnn,
            },
        ),
        PipelineItem(
            id="surya",
            kind="ocr",
            label="Surya",
            enabled=settings.surya_enabled,
            config={},
        ),
    ]
