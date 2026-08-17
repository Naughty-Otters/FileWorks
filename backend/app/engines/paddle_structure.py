"""PP-StructureV3 OCR engine strategy."""

from __future__ import annotations

import inspect
import logging
from pathlib import Path
from typing import Any

from app.engines.base import ExtractResult, OutputFormat
from app.engines.lazy import LazyModelEngine
from app.engines.paddle_init import create_pp_structure
from app.engines.utils import collect_texts, json_safe
from app.services.markdown import pick_best_markdown
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions
from app.services.pages import PAGE_SEPARATOR
from app.services.regions import extract_regions

logger = logging.getLogger(__name__)


class PaddleStructureEngine(LazyModelEngine):
    id = "structure"
    label = "PP-StructureV3"

    def supports_options(self) -> bool:
        return True  # all UI options map natively to Structure predict kwargs

    def _load(self) -> None:
        logger.info("Loading %s on device=%s", self.label, self.settings.paddle_device)
        try:
            self._pipeline = create_pp_structure(self.settings)
            self._init_error = None
            logger.info("%s ready", self.label)
        except Exception as exc:  # noqa: BLE001
            self._init_error = f"{self.label} init failed: {exc}"
            logger.warning(self._init_error)
            raise RuntimeError(self._init_error) from exc

    def extract(
        self,
        file_path: Path,
        *,
        output_format: OutputFormat = "both",
        options: ExtractOptions | None = None,
        mime_type: str | None = None,
    ) -> ExtractResult:
        del mime_type
        self.ensure_ready()
        assert self._pipeline is not None
        opts = options or DEFAULT_EXTRACT_OPTIONS

        if file_path.suffix.lower() == ".pdf":
            from app.services.pages import pdf_page_count

            if pdf_page_count(file_path) > 1:
                return self._extract_pdf_by_page(
                    file_path, output_format=output_format, options=opts
                )
        return self._extract_path(file_path, output_format=output_format, options=opts)

    def _extract_pdf_by_page(
        self,
        file_path: Path,
        *,
        output_format: OutputFormat,
        options: ExtractOptions,
    ) -> ExtractResult:
        import tempfile

        from app.services.cancel_token import check_cancelled

        pages: list[dict[str, Any]] = []
        markdown_parts: list[str] = []
        json_pages: list[Any] = []
        all_regions: list[dict[str, Any]] = []
        image_size = None

        from app.services.pages import PAGE_SEPARATOR, iter_pdf_page_bytes

        payloads = list(iter_pdf_page_bytes(file_path))
        total = len(payloads)
        for page_no, page_bytes in payloads:
            check_cancelled(where=f"Structure page {page_no}/{total}")
            with tempfile.NamedTemporaryFile(suffix=".pdf", delete=True) as tmp:
                tmp.write(page_bytes)
                tmp.flush()
                one = self._extract_path(
                    Path(tmp.name), output_format=output_format, options=options
                )
            page = (one.pages or [{"page": 1, "markdown": one.markdown or "", "json": one.json_data}])[0]
            page = {**page, "page": page_no}
            pages.append(page)
            if page.get("markdown"):
                markdown_parts.append(str(page["markdown"]))
            json_pages.append(page.get("json"))
            for region in one.regions or []:
                all_regions.append({**region, "page": page_no})
            if image_size is None and one.image_size is not None:
                image_size = one.image_size
            logger.info("Structure finished PDF page %s/%s", page_no, total)

        markdown = PAGE_SEPARATOR.join(part for part in markdown_parts if part).strip()
        result = ExtractResult(
            engine=self.label,
            provider=self.id,
            page_count=len(pages),
            pages=pages,
            regions=all_regions,
            image_size=image_size,
            options=options.to_dict(),
        )
        if output_format in {"markdown", "both"}:
            result.markdown = markdown
        if output_format in {"json", "both"}:
            result.json_data = {"pages": json_pages} if len(json_pages) > 1 else (
                json_pages[0] if json_pages else {}
            )
        return result

    def _extract_path(
        self,
        file_path: Path,
        *,
        output_format: OutputFormat,
        options: ExtractOptions,
    ) -> ExtractResult:
        from app.services.cancel_token import check_cancelled

        check_cancelled(where="Structure predict start")
        assert self._pipeline is not None
        opts = options
        path_str = str(file_path.resolve())
        predict_kwargs = opts.predict_kwargs()

        try:
            output = list(self._pipeline.predict(path_str, **predict_kwargs))
        except TypeError:
            output = self._predict_filtered(path_str, predict_kwargs)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Structure predict with options failed (%s); retrying core options", exc)
            fallback = ExtractOptions(
                use_doc_preprocessor=False,
                use_seal_recognition=False,
                use_table_recognition=opts.use_table_recognition,
                use_formula_recognition=False,
                use_chart_recognition=False,
                use_region_detection=opts.use_region_detection,
                format_block_content=opts.format_block_content,
            )
            try:
                output = list(self._pipeline.predict(path_str, **fallback.predict_kwargs()))
            except Exception:
                output = list(self._pipeline.predict(path_str))

        pages: list[dict[str, Any]] = []
        markdown_parts: list[str] = []
        json_pages: list[Any] = []

        for index, res in enumerate(output):
            check_cancelled(where=f"Structure result page {index + 1}")
            json_data = json_safe(getattr(res, "json", None) or {})
            md_info = getattr(res, "markdown", None)
            markdown = pick_best_markdown(pipeline_markdown=md_info, json_payload=json_data)
            if not markdown:
                texts = collect_texts(json_data)
                markdown = "\n".join(texts).strip()

            page = {"page": index + 1, "markdown": markdown, "json": json_data if json_data else {"raw": str(res)}}
            pages.append(page)
            if markdown:
                markdown_parts.append(markdown)
            json_pages.append(page["json"])

        all_regions: list[dict[str, Any]] = []
        image_size = None
        for page in pages:
            page_regions, size = extract_regions(page.get("json"), page=int(page.get("page") or 1))
            if image_size is None and size is not None:
                image_size = size
            all_regions.extend(page_regions)

        markdown = PAGE_SEPARATOR.join(part for part in markdown_parts if part).strip()
        result = ExtractResult(
            engine=self.label,
            provider=self.id,
            page_count=len(pages),
            pages=pages,
            regions=all_regions,
            image_size=image_size,
            options=opts.to_dict(),
        )
        if output_format in {"markdown", "both"}:
            result.markdown = markdown
        if output_format in {"json", "both"}:
            result.json_data = {"pages": json_pages} if len(json_pages) > 1 else (
                json_pages[0] if json_pages else {}
            )
        return result

    def _predict_filtered(self, path_str: str, predict_kwargs: dict[str, bool]) -> list[Any]:
        try:
            supported = set(inspect.signature(self._pipeline.predict).parameters)
        except (TypeError, ValueError):
            supported = set()
        filtered = {k: v for k, v in predict_kwargs.items() if not supported or k in supported}
        try:
            return list(self._pipeline.predict(path_str, **filtered))
        except TypeError:
            return list(self._pipeline.predict(path_str))
