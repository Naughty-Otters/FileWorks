"""Document processing pipeline facade."""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any, Literal

from app.core.logsetup import log_used_engine
from app.processing.decision import PriorityFallbackDecisionMaker
from app.processing.decision.base import EngineDecisionMaker
from app.processing.export.registry import ExportRegistry
from app.processing.models import ExportArtifact, OutputKind, ReadResult, SourceFile
from app.processing.reading.registry import ReaderRegistry
from app.services.markdown import markdown_looks_flat
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions

logger = logging.getLogger(__name__)

ApiOutputFormat = Literal["markdown", "json", "both"]


def _log_used_engine(result: ReadResult, *, filename: str) -> None:
    log_used_engine(result, filename=filename, logger=logger)


class DocumentPipeline:
    """
    Orchestrates:
    1. SourceFile normalization
    2. EngineDecisionMaker → ordered Reader candidates
    3. read() with fallback on soft failures
    4. Embed / compress document images, then optional translation
    5. FormatExporter for user-requested download formats
    """

    def __init__(
        self,
        *,
        readers: ReaderRegistry | None = None,
        decision: EngineDecisionMaker | None = None,
        exporters: ExportRegistry | None = None,
    ) -> None:
        self.readers = readers or ReaderRegistry()
        self.decision = decision or PriorityFallbackDecisionMaker()
        self.exporters = exporters or ExportRegistry()

    def list_readers(self) -> list[dict[str, object]]:
        return self.readers.describe()

    def list_export_formats(self) -> list[dict[str, object]]:
        return self.exporters.describe()

    def process(
        self,
        file_path: Path,
        *,
        filename: str | None = None,
        mime_type: str | None = None,
        options: ExtractOptions | None = None,
        preferred_output: OutputKind = OutputKind.MARKDOWN,
        api_output_format: ApiOutputFormat = "both",
    ) -> dict[str, Any]:
        """Run decision + read; return API-compatible dict."""
        source = SourceFile.from_path(file_path, filename=filename, mime_type=mime_type)
        opts = options or DEFAULT_EXTRACT_OPTIONS
        result = self.read(source, options=opts, preferred_output=preferred_output)
        result = self._postprocess(result, opts, source)
        _log_used_engine(result, filename=source.filename)
        include_md = api_output_format in {"markdown", "both"}
        include_json = api_output_format in {"json", "both"}
        return result.to_api_dict(include_markdown=include_md, include_json=include_json)

    def read(
        self,
        source: SourceFile,
        *,
        options: ExtractOptions | None = None,
        preferred_output: OutputKind = OutputKind.MARKDOWN,
    ) -> ReadResult:
        opts = options or DEFAULT_EXTRACT_OPTIONS
        candidates = self.decision.decide(source, self.readers.all(), opts)
        if not candidates:
            raise RuntimeError(
                f"No reader can process '{source.filename}' "
                f"(suffix={source.suffix}, mime={source.mime_type})"
            )

        errors: list[str] = []
        last_empty: ReadResult | None = None
        last_flat: ReadResult | None = None
        for index, (reader, capability) in enumerate(candidates):
            from app.services.cancel_token import check_cancelled

            check_cancelled(where=f"before reader={reader.id}")
            logger.info(
                "Trying reader=%s (priority=%s, confidence=%.2f, reason=%s, prefer_structure=%s)",
                reader.id,
                reader.priority,
                capability.confidence,
                capability.reason,
                opts.prefer_structure is True,
            )
            try:
                result = reader.read(
                    source,
                    options=opts,
                    preferred_output=preferred_output,
                )
            except Exception as exc:  # noqa: BLE001
                msg = f"{reader.id}: {exc}"
                logger.warning("Reader failed — %s", msg)
                errors.append(msg)
                continue

            markdown = result.markdown() or ""
            has_more = index < len(candidates) - 1
            if not markdown.strip():
                msg = f"{reader.id}: empty markdown"
                logger.warning("Reader produced no text — %s", msg)
                errors.append(msg)
                last_empty = result
                if has_more:
                    continue
                return result
            if (
                opts.prefer_structure
                and reader.id != "text"
                and has_more
                and markdown_looks_flat(markdown)
            ):
                msg = f"{reader.id}: flat markdown (prefer_structure)"
                logger.warning("Reader structure looks weak — %s", msg)
                errors.append(msg)
                last_flat = result
                continue
            return result

        if last_flat is not None:
            return last_flat
        if last_empty is not None:
            return last_empty

        raise RuntimeError(
            "All candidate readers failed for "
            f"'{source.filename}': {' | '.join(errors)}"
        )

    def _postprocess(self, result: ReadResult, options: ExtractOptions, source: SourceFile) -> ReadResult:
        from app.core.config import get_settings
        from app.processing.postprocess.media import embed_read_result_media

        result = embed_read_result_media(result, source)
        settings = get_settings()
        if (
            options.use_ai
            and result.engine_id != "llm"
            and not settings.llm_lambda_function
        ):
            from app.processing.postprocess import get_markdown_structure_editor

            editor = get_markdown_structure_editor()
            if editor.configured():
                logger.info("Editing markdown structure via LLM")
                result = editor.apply(result)
        lang = options.normalized_target_lang()
        if not lang:
            return result
        if settings.llm_lambda_function:
            raise RuntimeError("Translation must run on the LLM Lambda")
        from app.processing.postprocess import get_markdown_translator

        translator = get_markdown_translator()
        if not translator.configured():
            raise RuntimeError(translator.init_error or "Translation is not configured")
        logger.info("Translating markdown to %s via %s", lang, translator.spec.id if translator.spec else "?")
        return translator.apply(result, lang)

    def export(
        self,
        markdown: str,
        *,
        format_id: str,
        title: str = "document",
        read_result: ReadResult | None = None,
    ) -> ExportArtifact:
        exporter = self.exporters.resolve(format_id)
        if not exporter.can_export(OutputKind.MARKDOWN):
            raise ValueError(f"Exporter '{exporter.id}' cannot export Markdown source")
        return exporter.export(markdown=markdown, title=title, read_result=read_result)


_pipeline: DocumentPipeline | None = None
_pipeline_lock = threading.Lock()


def get_document_pipeline() -> DocumentPipeline:
    global _pipeline
    if _pipeline is None:
        with _pipeline_lock:
            if _pipeline is None:
                _pipeline = DocumentPipeline()
    return _pipeline
