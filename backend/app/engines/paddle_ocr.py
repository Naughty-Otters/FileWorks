"""Plain PP-OCR engine strategy with shared UI option adapters."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.engines.base import ExtractResult, OutputFormat
from app.engines.lazy import LazyModelEngine
from app.engines.utils import collect_texts, json_safe
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions
from app.services.pages import PAGE_SEPARATOR

logger = logging.getLogger(__name__)


class PaddleOCREngine(LazyModelEngine):
    id = "ocr"
    label = "PP-OCRv5"

    def supports_options(self) -> bool:
        return True

    def _load(self) -> None:
        from paddleocr import PaddleOCR

        logger.info("Loading %s on device=%s", self.label, self.settings.paddle_device)
        try:
            # Enable preprocessor modules at init so predict() can toggle them per request.
            self._pipeline = PaddleOCR(
                device=self.settings.paddle_device,
                use_doc_orientation_classify=True,
                use_doc_unwarping=True,
                use_textline_orientation=self.settings.use_textline_orientation,
            )
            self._init_error = None
            logger.info("%s ready", self.label)
        except Exception as exc:  # noqa: BLE001
            self._init_error = f"{self.label} init failed: {exc}"
            logger.error(self._init_error)
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
        opts = options or DEFAULT_EXTRACT_OPTIONS
        self.ensure_ready()
        assert self._pipeline is not None

        # Multi-page PDFs: one predict per page so Stop can land between pages
        # (Paddle's predict itself has no cancellation point).
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
        from app.services.pages import PAGE_SEPARATOR, iter_pdf_page_bytes

        pages: list[dict[str, Any]] = []
        markdown_parts: list[str] = []
        json_pages: list[Any] = []
        all_regions: list[dict[str, Any]] = []
        image_size: dict[str, float] | None = None

        payloads = list(iter_pdf_page_bytes(file_path))
        total = len(payloads)
        for page_no, page_bytes in payloads:
            check_cancelled(where=f"OCR page {page_no}/{total}")
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
            logger.info("OCR finished PDF page %s/%s", page_no, total)

        markdown = PAGE_SEPARATOR.join(markdown_parts).strip()
        result = ExtractResult(
            engine=self.label,
            provider=self.id,
            page_count=len(pages),
            pages=pages,
            regions=all_regions if options.use_region_detection else [],
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

        check_cancelled(where="OCR predict start")
        assert self._pipeline is not None
        path_str = str(file_path.resolve())
        opts = options

        predict_kwargs = opts.paddle_ocr_predict_kwargs()
        try:
            output = list(self._pipeline.predict(path_str, **predict_kwargs))
        except TypeError:
            # Older builds may reject unknown kwargs.
            filtered = {
                k: v
                for k, v in predict_kwargs.items()
                if k in {"use_doc_orientation_classify", "use_doc_unwarping", "use_textline_orientation"}
            }
            try:
                output = list(self._pipeline.predict(path_str, **filtered))
            except TypeError:
                output = list(self._pipeline.predict(path_str))

        # Advanced layout options: enrich via Structure when available (approx support).
        if self._needs_structure_enrichment(opts):
            enriched = self._try_structure_enrichment(file_path, output_format=output_format, options=opts)
            if enriched is not None:
                return enriched

        pages: list[dict[str, Any]] = []
        markdown_parts: list[str] = []
        json_pages: list[Any] = []
        all_regions: list[dict[str, Any]] = []
        image_size: dict[str, float] | None = None

        for index, res in enumerate(output):
            check_cancelled(where=f"OCR result page {index + 1}")
            page_no = index + 1
            json_data = json_safe(getattr(res, "json", None) or {})
            texts = collect_texts(json_data)
            page_md = self._format_texts(texts, opts)
            page_regions, size = self._regions_from_ocr_json(json_data, page=page_no, options=opts)
            if image_size is None and size is not None:
                image_size = size
            if opts.use_region_detection:
                all_regions.extend(page_regions)

            # Approx labels for toggles without native OCR modules.
            page_md = self._append_option_sections(page_md, opts)

            pages.append({"page": page_no, "markdown": page_md, "json": json_data})
            if page_md:
                markdown_parts.append(page_md)
            json_pages.append(json_data)

        markdown = PAGE_SEPARATOR.join(markdown_parts).strip()
        result = ExtractResult(
            engine=self.label,
            provider=self.id,
            page_count=len(pages),
            pages=pages,
            regions=all_regions if opts.use_region_detection else [],
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

    @staticmethod
    def _needs_structure_enrichment(options: ExtractOptions) -> bool:
        # Table can be approximated from line OCR; escalate only for modules OCR lacks.
        return bool(
            options.use_seal_recognition
            or options.use_formula_recognition
            or options.use_chart_recognition
        )

    def _try_structure_enrichment(
        self,
        file_path: Path,
        *,
        output_format: OutputFormat,
        options: ExtractOptions,
    ) -> ExtractResult | None:
        """Approx: reuse Structure for table/formula/seal/chart when OCR is the active engine."""
        try:
            from app.engines.paddle_structure import PaddleStructureEngine

            structure = PaddleStructureEngine(self.settings)
            structure.ensure_ready()
            result = structure.extract(file_path, output_format=output_format, options=options)
            # Keep provider as OCR (server chose OCR), but content comes from Structure enrichment.
            result.provider = self.id
            result.engine = f"{self.label}+Structure"
            result.options = options.to_dict()
            logger.info("OCR engine applied advanced options via Structure enrichment")
            return result
        except Exception as exc:  # noqa: BLE001
            logger.warning("Structure enrichment unavailable for OCR options (%s); using OCR approx", exc)
            return None

    @staticmethod
    def _format_texts(texts: list[str], options: ExtractOptions) -> str:
        cleaned = [t.strip() for t in texts if t and t.strip()]
        if not cleaned:
            return ""
        if options.format_block_content:
            # Paragraph-ish blocks: blank line between lines that look like sentences.
            return "\n\n".join(cleaned)
        return "\n".join(cleaned)

    @staticmethod
    def _append_option_sections(markdown: str, options: ExtractOptions) -> str:
        """Notes only when advanced modules were requested but Structure enrichment failed."""
        extra: list[str] = []
        if options.use_formula_recognition:
            extra.append("_Formula recognition approximated via plain OCR text._")
        if options.use_seal_recognition:
            extra.append("_Seal recognition approximated (no dedicated seal module)._")
        if options.use_chart_recognition:
            extra.append("_Chart recognition approximated (no dedicated chart module)._")
        if not extra:
            return markdown
        note = "\n".join(extra)
        return f"{markdown}\n\n{note}".strip() if markdown else note

    @staticmethod
    def _regions_from_ocr_json(
        json_data: Any,
        *,
        page: int,
        options: ExtractOptions,
    ) -> tuple[list[dict[str, Any]], dict[str, float] | None]:
        if not options.use_region_detection:
            return [], None

        payload = json_data
        if isinstance(payload, dict) and "res" in payload and isinstance(payload["res"], dict):
            payload = payload["res"]
        if not isinstance(payload, dict):
            return [], None

        width = payload.get("width") or payload.get("input_img_width")
        height = payload.get("height") or payload.get("input_img_height")
        image_size = None
        try:
            if width is not None and height is not None:
                image_size = {"width": float(width), "height": float(height)}
        except (TypeError, ValueError):
            image_size = None

        texts = payload.get("rec_texts") or payload.get("texts") or []
        boxes = (
            payload.get("rec_boxes")
            or payload.get("dt_polys")
            or payload.get("rec_polys")
            or payload.get("boxes")
            or []
        )
        regions: list[dict[str, Any]] = []
        if not isinstance(boxes, list):
            return regions, image_size

        for index, box in enumerate(boxes):
            bbox = PaddleOCREngine._as_bbox(box)
            if bbox is None:
                continue
            text = ""
            if isinstance(texts, list) and index < len(texts) and isinstance(texts[index], str):
                text = texts[index].strip()
            label = "text"
            if options.use_table_recognition and text.count("|") >= 2:
                label = "table"
            if options.use_formula_recognition and any(ch in text for ch in ("=", "∑", "√", "^", "_")):
                label = "formula"
            regions.append(
                {
                    "id": f"ocr-{page}-{index}",
                    "page": page,
                    "label": label,
                    "text": text,
                    "bbox": bbox,
                    "order": index + 1,
                    "score": None,
                }
            )
        return regions, image_size

    @staticmethod
    def _as_bbox(raw: Any) -> list[float] | None:
        if isinstance(raw, (list, tuple)) and len(raw) == 4 and all(
            isinstance(v, (int, float)) for v in raw
        ):
            x1, y1, x2, y2 = map(float, raw)
            if x2 <= x1 or y2 <= y1:
                return None
            return [x1, y1, x2, y2]
        # Polygon [[x,y], ...]
        if isinstance(raw, (list, tuple)) and raw and isinstance(raw[0], (list, tuple)):
            try:
                xs = [float(p[0]) for p in raw]
                ys = [float(p[1]) for p in raw]
            except (TypeError, ValueError, IndexError):
                return None
            if not xs or not ys:
                return None
            return [min(xs), min(ys), max(xs), max(ys)]
        return None
