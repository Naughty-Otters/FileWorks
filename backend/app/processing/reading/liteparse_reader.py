"""LiteParse reader — layout extraction with OCR strategy routing."""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import get_settings
from app.processing.models import Capability, DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.reading.base import Reader
from app.processing.reading.provider_adapter import IMAGE_AND_PDF_SUFFIXES
from app.processing.strategy.ocr import (
    DefaultOcrRoutingStrategy,
    OcrRoute,
    build_liteparse_attempts,
    markdown_is_weak,
    pick_best_parse_result,
)
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions
from app.services.pages import PAGE_SEPARATOR, assemble_page_dicts, pdf_page_count

logger = logging.getLogger(__name__)

_LITEPARSE_IMPORT_ERROR: str | None = None


def liteparse_is_available() -> bool:
    global _LITEPARSE_IMPORT_ERROR
    try:
        from app.core.venvpath import import_unshadowed

        import_unshadowed("liteparse")
        from liteparse import LiteParse  # noqa: F401

        _LITEPARSE_IMPORT_ERROR = None
        return True
    except Exception as exc:  # noqa: BLE001
        _LITEPARSE_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"
        logger.warning("liteparse extra is not usable: %s", _LITEPARSE_IMPORT_ERROR)
        return False


def _import_liteparse() -> Any:
    from app.core.venvpath import import_unshadowed

    return import_unshadowed("liteparse").LiteParse


class LiteParseReader(Reader):
    """
    LlamaIndex LiteParse — PDFium layout + Markdown.

    Local OCR chains are planned by ``DefaultOcrRoutingStrategy`` (server-side).
    LLM vision ordering is handled by ``ReaderOrderingStrategy`` in the pipeline.
    """

    id = "liteparse"
    label = "LiteParse"

    def __init__(self) -> None:
        settings = get_settings()
        self.priority = int(settings.liteparse_priority)
        self._ocr_strategy = DefaultOcrRoutingStrategy()

    def can_process(
        self,
        source: SourceFile,
        options: ExtractOptions | None = None,
    ) -> Capability:
        settings = get_settings()
        if not settings.liteparse_enabled:
            return Capability.no("LiteParse is disabled (LITEPARSE_ENABLED=false)")
        if not liteparse_is_available():
            detail = _LITEPARSE_IMPORT_ERROR or "import failed"
            return Capability.no(f"liteparse extra is not installed ({detail})")
        if source.is_image:
            return Capability.yes("raster image — LiteParse", confidence=0.88)
        if source.suffix == ".pdf":
            return Capability.yes("PDF — LiteParse layout + selective OCR", confidence=0.82)
        if source.suffix in IMAGE_AND_PDF_SUFFIXES:
            return Capability.yes(f"LiteParse can attempt {source.suffix}", confidence=0.55)
        return Capability.no(f"LiteParse handles PDF and images, not {source.suffix}")

    def read(
        self,
        source: SourceFile,
        *,
        options: ExtractOptions | None = None,
        preferred_output: OutputKind = OutputKind.MARKDOWN,
    ) -> ReadResult:
        del preferred_output
        opts = options or DEFAULT_EXTRACT_OPTIONS
        settings = get_settings()
        LiteParse = _import_liteparse()

        plan = self._ocr_strategy.plan(source, opts, settings=settings)
        ocr_enabled = plan.assessment.needs_ocr
        parse_attempts = plan.liteparse_attempts

        logger.info(
            "LiteParse OCR plan for %s: route=%s needs_ocr=%s attempts=%s",
            source.filename,
            plan.route.value,
            ocr_enabled,
            [item.name for item in parse_attempts],
        )

        attempts: list[tuple[str, str | None, Any]] = []
        for attempt in parse_attempts:
            use_url = attempt.ocr_server_url if ocr_enabled else None
            logger.info(
                "LiteParse parsing %s attempt=%s ocr=%s server=%s dpi=%s",
                source.filename,
                attempt.name,
                ocr_enabled,
                use_url or "tesseract",
                settings.liteparse_dpi,
            )
            parser = LiteParse(
                output_format="markdown",
                dpi=int(settings.liteparse_dpi),
                ocr_enabled=ocr_enabled,
                ocr_server_url=use_url,
                ocr_language=settings.liteparse_ocr_language,
                image_mode="placeholder",
                extract_images=False,
                extract_links=True,
                num_workers=1,
                quiet=True,
            )
            result = parser.parse(str(source.path))
            attempts.append((attempt.name, use_url, result))
            md = str(getattr(result, "text", None) or "").strip()
            if ocr_enabled and attempt.name != parse_attempts[-1].name and not markdown_is_weak(md):
                break

        result, tier_name, ocr_url = pick_best_parse_result(attempts, needs_ocr=ocr_enabled)
        logger.info("LiteParse selected attempt=%s for %s", tier_name, source.filename)

        pages_out: list[dict[str, Any]] = []
        markdown_parts: list[str] = []
        all_regions: list[dict[str, Any]] = []

        for page in result.pages or []:
            page_no = int(getattr(page, "page_num", 0) or len(pages_out) + 1)
            page_md = str(getattr(page, "markdown", None) or getattr(page, "text", None) or "").strip()
            page_json: dict[str, Any] = {
                "source": self.id,
                "page_num": page_no,
                "width": getattr(page, "width", None),
                "height": getattr(page, "height", None),
            }
            text_items = getattr(page, "text_items", None) or []
            if text_items:
                page_json["text_items"] = [
                    {
                        "text": getattr(item, "text", ""),
                        "x": getattr(item, "x", None),
                        "y": getattr(item, "y", None),
                        "width": getattr(item, "width", None),
                        "height": getattr(item, "height", None),
                    }
                    for item in text_items
                ]
                if opts.use_region_detection:
                    all_regions.extend(_regions_from_text_items(text_items, page=page_no))

            pages_out.append({"page": page_no, "markdown": page_md, "json": page_json})
            if page_md:
                markdown_parts.append(page_md)

        full_md = str(result.text or "").strip()
        if not full_md and markdown_parts:
            full_md = PAGE_SEPARATOR.join(markdown_parts).strip()

        if not pages_out and full_md:
            pages_out, _, full_md = assemble_page_dicts([full_md], source=self.id)

        page_count = int(getattr(result, "total_pages", 0) or len(pages_out) or 1)
        if source.suffix == ".pdf":
            source_pages = pdf_page_count(source.path)
            if source_pages:
                page_count = max(page_count, source_pages)

        plan_meta = plan.to_metadata()
        json_payload: dict[str, Any] = {
            "source": self.id,
            "pages": [page.get("json") for page in pages_out],
            "ocr_enabled": ocr_enabled,
            "ocr_attempt": tier_name,
            "ocr_server_url": ocr_url,
            "ocr_attempts": [name for name, _, _ in attempts],
            **plan_meta,
        }

        metadata = {
            "ocr_enabled": ocr_enabled,
            "ocr_attempt": tier_name,
            "ocr_server": ocr_url or "tesseract",
            "dpi": settings.liteparse_dpi,
            **plan_meta,
        }

        return ReadResult(
            engine_id=self.id,
            engine_label=self.label,
            outputs=[
                DocumentOutput(kind=OutputKind.MARKDOWN, content=full_md),
                DocumentOutput(kind=OutputKind.TEXT, content=full_md),
                DocumentOutput(kind=OutputKind.JSON, data=json_payload),
            ],
            pages=pages_out,
            regions=all_regions,
            page_count=page_count,
            metadata=metadata,
            options=opts.to_dict(),
        )

    def describe(self) -> dict[str, object]:
        settings = get_settings()
        payload = super().describe()
        available = liteparse_is_available()
        payload["configured"] = available and settings.liteparse_enabled
        payload["error"] = None if available else "Install with: uv sync --all-extras"
        return payload


def _regions_from_text_items(text_items: Any, *, page: int) -> list[dict[str, Any]]:
    regions: list[dict[str, Any]] = []
    for index, item in enumerate(text_items):
        text = str(getattr(item, "text", "") or "").strip()
        if not text:
            continue
        try:
            x = float(getattr(item, "x", 0))
            y = float(getattr(item, "y", 0))
            w = float(getattr(item, "width", 0))
            h = float(getattr(item, "height", 0))
        except (TypeError, ValueError):
            continue
        if w <= 0 or h <= 0:
            continue
        regions.append(
            {
                "id": f"liteparse-{page}-{index}",
                "page": page,
                "label": "text",
                "text": text,
                "bbox": [x, y, x + w, y + h],
                "order": index + 1,
                "score": None,
            }
        )
    return regions
