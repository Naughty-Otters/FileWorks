"""Prepare images / PDF pages for vision LLM requests."""

from __future__ import annotations

import io
import logging
from pathlib import Path

from PIL import Image

logger = logging.getLogger(__name__)

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}


def encode_image_file(path: Path, *, max_side: int = 2048, quality: int = 85) -> tuple[bytes, str]:
    with Image.open(path) as image:
        return _encode_pil(image, max_side=max_side, quality=quality)


def render_pdf_pages(
    path: Path,
    *,
    max_pages: int = 8,
    scale: float = 2.0,
    max_side: int = 2048,
    quality: int = 85,
) -> list[tuple[bytes, str]]:
    try:
        import pypdfium2 as pdfium
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError(
            "PDF rasterization requires pypdfium2. Install backend deps with uv sync."
        ) from exc

    document = pdfium.PdfDocument(str(path))
    pages: list[tuple[bytes, str]] = []
    try:
        total = len(document)
        count = min(total, max_pages)
        if total > max_pages:
            logger.warning(
                "PDF has %s pages; rasterizing the first %s for the LLM (llm_max_pages)",
                total,
                max_pages,
            )
        for index in range(count):
            page = document[index]
            bitmap = page.render(scale=scale)
            pil = bitmap.to_pil()
            pages.append(_encode_pil(pil, max_side=max_side, quality=quality))
            page.close()
    finally:
        document.close()
    if not pages:
        raise RuntimeError("PDF has no pages to send to the LLM")
    logger.info("Rasterized %s PDF page(s) from %s", len(pages), path.name)
    return pages


def _encode_pil(image: Image.Image, *, max_side: int, quality: int) -> tuple[bytes, str]:
    rgb = image.convert("RGB")
    width, height = rgb.size
    longest = max(width, height)
    if longest > max_side:
        ratio = max_side / longest
        rgb = rgb.resize((max(1, int(width * ratio)), max(1, int(height * ratio))), Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    rgb.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue(), "image/jpeg"
