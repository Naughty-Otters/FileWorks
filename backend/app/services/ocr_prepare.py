"""Downscale raster / scanned-PDF inputs before Paddle OCR to cap memory use."""

from __future__ import annotations

import logging
import sys
import uuid
from pathlib import Path

from PIL import Image

from app.core.config import Settings, get_settings
from app.processing.models import SourceFile
from app.services.options import ExtractOptions
from app.services.pages import pdf_has_text_layer_majority

logger = logging.getLogger(__name__)

IMAGE_SUFFIXES = frozenset(
    {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}
)

# ~150 dpi A4 long edge (1240×1754) and ~300 dpi A4 long edge (2480×3508).
DEFAULT_MAX_INPUT_SIDE = 1754
HIGH_QUALITY_MAX_INPUT_SIDE = 2480


# Paddle on macOS / ARM often segfaults above ~1296 px (see PaddleOCR #16457).
MAC_SAFE_MAX_INPUT_SIDE = 1200


def resolve_ocr_max_input_side(
    options: ExtractOptions,
    settings: Settings | None = None,
) -> int:
    settings = settings or get_settings()
    if options.ocr_high_quality:
        cap = max(1, int(settings.ocr_max_input_side_high))
    else:
        cap = max(1, int(settings.ocr_max_input_side_default))

    platform_cap = settings.ocr_platform_max_input_side
    if platform_cap is None and sys.platform == "darwin":
        platform_cap = MAC_SAFE_MAX_INPUT_SIDE

    if platform_cap is not None:
        platform_cap = max(1, int(platform_cap))
        if cap > platform_cap:
            logger.info(
                "OCR input capped by platform limit %s (requested %s, high_quality=%s)",
                platform_cap,
                cap,
                options.ocr_high_quality,
            )
            cap = platform_cap
    return cap


def should_prepare_ocr_input(
    source: SourceFile,
    settings: Settings | None = None,
) -> bool:
    """True when the file is likely to hit Paddle as a raster or scanned PDF."""
    from app.processing import paddle_gate

    if not paddle_gate.paddle_ocr_is_enabled(settings):
        return False
    if source.is_image or source.suffix in IMAGE_SUFFIXES:
        return True
    if source.suffix == ".pdf":
        return not pdf_has_text_layer_majority(source.path)
    return False


def prepare_ocr_input(
    source: SourceFile,
    options: ExtractOptions,
    *,
    settings: Settings | None = None,
    work_dir: Path | None = None,
) -> SourceFile:
    """Return ``source``, or a temp copy with capped raster dimensions for OCR."""
    settings = settings or get_settings()
    if not should_prepare_ocr_input(source, settings):
        return source

    max_side = resolve_ocr_max_input_side(options, settings)
    work_dir = work_dir or source.path.parent

    if source.suffix == ".pdf":
        prepared = _prepare_pdf(source, max_side=max_side, work_dir=work_dir)
        if prepared is None:
            return source
        return prepared

    if source.is_image or source.suffix in IMAGE_SUFFIXES:
        prepared = _prepare_image(source, max_side=max_side, work_dir=work_dir)
        if prepared is None:
            return source
        return prepared

    return source


def _prepare_image(source: SourceFile, *, max_side: int, work_dir: Path) -> SourceFile | None:
    try:
        with Image.open(source.path) as image:
            image.load()
            rgb = _to_rgb(image)
            resized = _resize_if_needed(rgb, max_side=max_side)
            if resized is rgb:
                return None
            out_path = work_dir / f"ocr-prep-{uuid.uuid4().hex}.jpg"
            resized.save(out_path, format="JPEG", quality=92, optimize=True)
            logger.info(
                "OCR input resized %s (%sx%s) -> %s (%sx%s) max_side=%s",
                source.filename,
                rgb.width,
                rgb.height,
                out_path.name,
                resized.width,
                resized.height,
                max_side,
            )
            return SourceFile(
                path=out_path.resolve(),
                filename=source.filename,
                suffix=".jpg",
                mime_type="image/jpeg",
                size_bytes=out_path.stat().st_size,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("OCR input resize skipped for %s (%s)", source.filename, exc)
        return None


def _prepare_pdf(source: SourceFile, *, max_side: int, work_dir: Path) -> SourceFile | None:
    try:
        import pypdfium2 as pdfium
    except ImportError:  # pragma: no cover
        logger.warning("pypdfium2 missing; cannot rasterize PDF for OCR prep")
        return None

    try:
        document = pdfium.PdfDocument(str(source.path))
    except Exception as exc:  # noqa: BLE001
        logger.warning("OCR PDF prep skipped for %s (%s)", source.filename, exc)
        return None

    page_images: list[Image.Image] = []
    try:
        for index in range(len(document)):
            page = document[index]
            try:
                width_pt = float(page.get_width())
                height_pt = float(page.get_height())
                long_edge_pt = max(width_pt, height_pt, 1.0)
                scale = min(max_side / long_edge_pt, 6.0)
                bitmap = page.render(scale=scale)
                pil = bitmap.to_pil().convert("RGB")
                page_images.append(_resize_if_needed(pil, max_side=max_side))
            finally:
                page.close()
    finally:
        document.close()

    if not page_images:
        return None

    out_path = work_dir / f"ocr-prep-{uuid.uuid4().hex}.pdf"
    dpi = min(300.0, max_side / max(page_images[0].size) * 72.0)
    page_images[0].save(
        out_path,
        format="PDF",
        save_all=True,
        append_images=page_images[1:],
        resolution=dpi,
    )
    logger.info(
        "OCR PDF rasterized %s (%s pages) -> %s max_side=%s",
        source.filename,
        len(page_images),
        out_path.name,
        max_side,
    )
    return SourceFile(
        path=out_path.resolve(),
        filename=source.filename,
        suffix=".pdf",
        mime_type="application/pdf",
        size_bytes=out_path.stat().st_size,
    )


def _to_rgb(image: Image.Image) -> Image.Image:
    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        background = Image.new("RGB", image.size, (255, 255, 255))
        rgba = image.convert("RGBA")
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    if image.mode != "RGB":
        return image.convert("RGB")
    return image


def _resize_if_needed(image: Image.Image, *, max_side: int) -> Image.Image:
    width, height = image.size
    longest = max(width, height)
    if longest <= max_side:
        return image
    ratio = max_side / longest
    new_size = (max(1, int(width * ratio)), max(1, int(height * ratio)))
    return image.resize(new_size, Image.Resampling.LANCZOS)
