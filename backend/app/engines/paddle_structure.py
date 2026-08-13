"""PP-StructureV3 OCR engine strategy."""

from __future__ import annotations

import inspect
import logging
import threading
from pathlib import Path
from typing import Any

from app.core.config import Settings
from app.engines.base import ExtractResult, OCREngine, OutputFormat
from app.engines.utils import collect_texts, json_safe
from app.services.markdown import pick_best_markdown
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions
from app.services.regions import extract_regions

logger = logging.getLogger(__name__)


class PaddleStructureEngine(OCREngine):
    id = "structure"
    label = "PP-StructureV3"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._pipeline: Any = None
        self._lock = threading.Lock()
        self._init_error: str | None = None

    @property
    def ready(self) -> bool:
        return self._pipeline is not None

    @property
    def init_error(self) -> str | None:
        return self._init_error

    def supports_options(self) -> bool:
        return True  # all UI options map natively to Structure predict kwargs

    def ensure_ready(self) -> None:
        if self._pipeline is not None:
            return
        with self._lock:
            if self._pipeline is not None:
                return
            self._load()

    def _load(self) -> None:
        from paddleocr import PPStructureV3

        logger.info("Loading %s on device=%s", self.label, self.settings.paddle_device)
        try:
            try:
                self._pipeline = PPStructureV3(
                    device=self.settings.paddle_device,
                    use_doc_orientation_classify=True,
                    use_doc_unwarping=True,
                    use_textline_orientation=self.settings.use_textline_orientation,
                    use_table_recognition=True,
                    use_formula_recognition=True,
                    use_seal_recognition=True,
                    use_chart_recognition=True,
                    use_region_detection=True,
                    format_block_content=True,
                )
            except TypeError:
                try:
                    self._pipeline = PPStructureV3(
                        device=self.settings.paddle_device,
                        use_doc_orientation_classify=True,
                        use_doc_unwarping=True,
                        use_textline_orientation=self.settings.use_textline_orientation,
                        use_table_recognition=True,
                        use_formula_recognition=True,
                        format_block_content=True,
                    )
                except TypeError:
                    self._pipeline = PPStructureV3(
                        device=self.settings.paddle_device,
                        use_doc_orientation_classify=self.settings.use_doc_orientation_classify,
                        use_doc_unwarping=self.settings.use_doc_unwarping,
                        use_textline_orientation=self.settings.use_textline_orientation,
                    )
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
        self.ensure_ready()
        assert self._pipeline is not None
        opts = options or DEFAULT_EXTRACT_OPTIONS
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

        markdown = "\n\n---\n\n".join(part for part in markdown_parts if part).strip()
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
