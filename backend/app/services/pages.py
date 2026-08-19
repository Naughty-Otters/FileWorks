"""Shared source-page helpers for every reader / engine.

Contract: ``page_count == len(pages)`` and each page is
``{"page": int, "markdown": str, "json": ...}``. Joined Markdown uses
``PAGE_SEPARATOR`` between pages (same convention as Paddle OCR).
"""

from __future__ import annotations

import io
import logging
from collections.abc import Iterator, Sequence
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PAGE_SEPARATOR = "\n\n---\n\n"

# A page counts as "has text" when its native PDF text layer has at least this many
# non-whitespace characters. Below that it is treated as scanned / image-only.
TEXT_PAGE_MIN_CHARS = 40
# Skip OCR when more than this fraction of pages have a usable text layer.
TEXT_MAJORITY_RATIO = 0.5


def assemble_page_dicts(
    markdowns: Sequence[str],
    *,
    source: str,
    extra: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], int, str]:
    """Build ``pages[]``, ``page_count``, and joined Markdown from per-page strings."""
    extra = extra or {}
    texts = [str(markdown or "") for markdown in markdowns] or [""]
    pages: list[dict[str, Any]] = []
    for index, text in enumerate(texts, start=1):
        payload = {"source": source, "text": text, **extra}
        pages.append({"page": index, "markdown": text, "json": payload})
    joined = PAGE_SEPARATOR.join(
        page["markdown"] for page in pages if str(page.get("markdown") or "").strip()
    ).strip()
    return pages, len(pages), joined


def pdf_page_count(path: Path) -> int:
    """Number of pages in a PDF, or 0 if the file cannot be opened."""
    try:
        import pypdfium2 as pdfium
    except ImportError:  # pragma: no cover
        logger.warning("pypdfium2 is not installed; cannot count PDF pages")
        return 0
    try:
        document = pdfium.PdfDocument(str(path))
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not count PDF pages in %s (%s)", path.name, exc)
        return 0
    try:
        return len(document)
    finally:
        document.close()


def rasterize_pdf_bytes(
    data: bytes,
    *,
    scale: float = 1.6,
    max_side: int = 1200,
    quality: int = 80,
) -> tuple[bytes, str] | None:
    """Render the first page of a PDF (often a split single page) to JPEG bytes."""
    try:
        import pypdfium2 as pdfium
    except ImportError:  # pragma: no cover
        logger.warning("pypdfium2 is not installed; cannot rasterize PDF page")
        return None
    try:
        document = pdfium.PdfDocument(data)
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not open PDF bytes for rasterize (%s)", exc)
        return None
    image = None
    try:
        if len(document) < 1:
            return None
        page = document[0]
        try:
            bitmap = page.render(scale=scale)
            image = bitmap.to_pil()
        finally:
            page.close()
    except Exception as exc:  # noqa: BLE001
        logger.info("PDF page rasterize failed (%s)", exc)
        return None
    finally:
        document.close()
    if image is None:
        return None

    from PIL import Image

    rgb = image.convert("RGB")
    width, height = rgb.size
    longest = max(width, height)
    if longest > max_side > 0:
        ratio = max_side / longest
        rgb = rgb.resize(
            (max(1, int(width * ratio)), max(1, int(height * ratio))),
            Image.Resampling.LANCZOS,
        )
    buffer = io.BytesIO()
    rgb.save(buffer, format="JPEG", quality=quality, optimize=True)
    return buffer.getvalue(), "image/jpeg"


def iter_pdf_page_bytes(path: Path) -> Iterator[tuple[int, bytes]]:
    """Yield ``(1-based page number, single-page PDF bytes)`` for each source page."""
    import pypdfium2 as pdfium

    source = pdfium.PdfDocument(str(path))
    try:
        for index in range(len(source)):
            dest = pdfium.PdfDocument.new()
            try:
                dest.import_pages(source, pages=[index])
                buffer = io.BytesIO()
                dest.save(buffer)
                yield index + 1, buffer.getvalue()
            finally:
                dest.close()
    finally:
        source.close()


def pdf_page_texts(path: Path) -> list[str]:
    """Native text-layer string for every PDF page (empty string when none)."""
    try:
        import pypdfium2 as pdfium
    except ImportError:  # pragma: no cover
        logger.warning("pypdfium2 is not installed; cannot read PDF text layer")
        return []
    try:
        document = pdfium.PdfDocument(str(path))
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not open PDF text layer in %s (%s)", path.name, exc)
        return []
    try:
        pages: list[str] = []
        for index in range(len(document)):
            page = document[index]
            try:
                textpage = page.get_textpage()
                try:
                    raw = textpage.get_text_bounded() or ""
                finally:
                    textpage.close()
            except Exception:  # noqa: BLE001
                raw = ""
            finally:
                page.close()
            pages.append(_normalize_pdf_text(raw))
        return pages
    finally:
        document.close()


def pdf_majority_has_text(
    path: Path,
    *,
    min_chars: int = TEXT_PAGE_MIN_CHARS,
    ratio: float = TEXT_MAJORITY_RATIO,
) -> bool:
    """True when more than ``ratio`` of pages have a usable native text layer."""
    texts = pdf_page_texts(path)
    if not texts:
        return False
    with_text = sum(1 for text in texts if len(text) >= min_chars)
    return (with_text / len(texts)) > ratio


@lru_cache(maxsize=64)
def _majority_has_text_cached(identity: tuple[str, int, int]) -> bool:
    return pdf_majority_has_text(Path(identity[0]))


def pdf_has_text_layer_majority(path: Path) -> bool:
    """``pdf_majority_has_text`` cached on file identity.

    Reader selection and the OCR reader both need this answer for the same file,
    and extracting every page's text twice is pure waste on large documents.
    """
    try:
        stat = path.stat()
    except OSError:
        return pdf_majority_has_text(path)
    return _majority_has_text_cached((str(path), stat.st_size, stat.st_mtime_ns))


def pdf_text_layer_stats(
    path: Path,
    *,
    min_chars: int = TEXT_PAGE_MIN_CHARS,
) -> tuple[list[str], int, int]:
    """Return ``(page_texts, pages_with_text, page_count)``."""
    texts = pdf_page_texts(path)
    with_text = sum(1 for text in texts if len(text) >= min_chars)
    return texts, with_text, len(texts)


def _normalize_pdf_text(raw: str) -> str:
    """Light cleanup so PDF text layers read as Markdown-ish paragraphs."""
    if not raw:
        return ""
    lines = [line.rstrip() for line in raw.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    cleaned: list[str] = []
    blank = False
    for line in lines:
        if not line.strip():
            if cleaned and not blank:
                cleaned.append("")
            blank = True
            continue
        cleaned.append(line)
        blank = False
    while cleaned and not cleaned[-1]:
        cleaned.pop()
    return "\n".join(cleaned).strip()


def docling_page_markdowns(document: Any) -> list[str]:
    """Export one Markdown string per Docling page; fall back to a single blob."""
    full = str(document.export_to_markdown() or "")
    page_nos = _docling_page_numbers(getattr(document, "pages", None))
    if len(page_nos) <= 1:
        return [full] if full else [""]
    markdowns: list[str] = []
    for page_no in page_nos:
        try:
            markdowns.append(str(document.export_to_markdown(page_no=page_no) or ""))
        except TypeError:
            return [full] if full else [""]
    if not any(part.strip() for part in markdowns):
        return [full] if full else markdowns
    return markdowns


def _docling_page_numbers(pages: Any) -> list[int]:
    if isinstance(pages, dict) and pages:
        try:
            return sorted(int(key) for key in pages)
        except (TypeError, ValueError):
            return []
    if isinstance(pages, (list, tuple)) and len(pages) > 1:
        numbers: list[int] = []
        for index, item in enumerate(pages, start=1):
            raw = getattr(item, "page_no", None) or getattr(item, "page_number", None) or index
            try:
                numbers.append(int(raw))
            except (TypeError, ValueError):
                numbers.append(index)
        return numbers
    return []
