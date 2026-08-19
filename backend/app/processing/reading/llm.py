"""LLM reader — vision models convert images / PDFs to Markdown."""

from __future__ import annotations

from app.core.config import get_settings
from app.engines.llm import LLMEngine
from app.processing.models import Capability, OutputKind, ReadResult, SourceFile
from app.processing.reading.base import Reader
from app.processing.reading.provider_adapter import IMAGE_AND_PDF_SUFFIXES, read_with_provider
from app.services.options import ExtractOptions


class LLMReader(Reader):
    """
    Optional cloud LLM path. Inactive until LLM_PROVIDER + API key are set.

    Default priority is after AnyDoc and before local OCR so configured
    deployments can prefer model quality; raise LLM_PRIORITY to demote it.
    """

    id = "llm"
    label = "LLM"

    def __init__(self) -> None:
        settings = get_settings()
        self.priority = int(settings.llm_priority)
        self._engine = LLMEngine(settings)

    def can_process(
        self,
        source: SourceFile,
        options: ExtractOptions | None = None,
    ) -> Capability:
        from app.processing.pipeline_config import get_pipeline_spec

        blocked = get_pipeline_spec(get_settings()).reader_disabled_reason(self.id)
        if blocked:
            return Capability.no(blocked)
        if not self._engine.configured():
            return Capability.no(self._engine.init_error or "LLM is not configured")
        if get_settings().llm_lambda_function:
            return Capability.no("LLM runs on the sibling Lambda")
        if options is not None and not options.use_ai:
            return Capability.no("Read with AI is off")
        if not self._engine.supports_vision:
            return Capability.no(self._engine.vision_error or "LLM does not accept files")
        if source.is_image:
            return Capability.yes("raster image — LLM vision", confidence=0.95)
        if source.suffix == ".pdf":
            return Capability.yes("PDF — LLM vision / document", confidence=0.55)
        if source.suffix in IMAGE_AND_PDF_SUFFIXES:
            return Capability.yes(f"LLM can attempt {source.suffix}", confidence=0.5)
        return Capability.no(f"LLM does not handle {source.suffix}")

    def read(
        self,
        source: SourceFile,
        *,
        options: ExtractOptions | None = None,
        preferred_output: OutputKind = OutputKind.MARKDOWN,
    ) -> ReadResult:
        del preferred_output
        return read_with_provider(
            provider=self._engine,
            reader_id=self.id,
            reader_label=self.label,
            source=source,
            options=options,
        )

    def describe(self) -> dict[str, object]:
        payload = super().describe()
        payload.update(self._engine.describe())
        payload["kind"] = "reader"
        payload["id"] = self.id
        return payload
