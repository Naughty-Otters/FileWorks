"""Compress, place, and persist document images carried in Markdown.

Live convert/preview/download uses ``![alt](data:image/jpeg;base64,...)``.
History stores sidecar files ``docs/{id}/media/n.jpg`` and expands them
back to data URLs on read so the UI never changes.
"""

from __future__ import annotations

import base64
import hashlib
import io
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.processing.models import ReadResult, SourceFile
from app.services.pages import PAGE_SEPARATOR

logger = logging.getLogger(__name__)

MAX_IMAGES = 20
MAX_EDGE = 1200
MAX_BYTES = 400_000
MIN_EDGE = 24
JPEG_QUALITY = 80
MIN_DISPLAY_PT = 36
FULL_PAGE_AREA = 0.45

MEDIA_DIR = "media"
_MEDIA_NAME_RE = re.compile(r"^[0-9]+\.(jpe?g|png|gif|webp)$", re.I)
_DATA_URL_RE = re.compile(
    r"data:(image/[A-Za-z0-9.+-]+)(?:;charset=[^;]+)?;base64,([A-Za-z0-9+/=\s]+)",
    re.I,
)
_MD_IMG_RE = re.compile(r'!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)')
_HTML_IMG_RE = re.compile(
    r"""<img\b([^>]*?)\bsrc\s*=\s*(['"])(.*?)\2([^>]*)/?>""",
    flags=re.IGNORECASE | re.DOTALL,
)
_IMAGE_MARKUP_RE = re.compile(
    r'!\[([^\]]*)\]\((data:image/[^)\s]+|media/[0-9]+\.(?:jpe?g|png|gif|webp))(?:\s+"[^"]*")?\)'
    r"""|<img\b[^>]*\bsrc\s*=\s*(['"])(data:image/[^"']+|media/[0-9]+\.(?:jpe?g|png|gif|webp))\2[^>]*/?>""",
    flags=re.IGNORECASE | re.DOTALL,
)
_PLACEHOLDER_RE = re.compile(r"@@FWIMG(\d+)@@")


@dataclass
class EmbeddedImage:
    """An image to splice into Markdown in reading (or page) order."""

    alt: str
    data: bytes
    mime: str = "image/jpeg"
    page: int | None = None
    display_width: int | None = None
    display_height: int | None = None
    y_frac: float | None = None
    x_frac: float | None = None
    page_hint: str | None = None
    page_count: int | None = None


@dataclass
class MediaFile:
    name: str
    data: bytes
    content_type: str


@dataclass
class FoldedPayload:
    markdown: str | None
    json_data: Any
    pages: list[dict[str, Any]]
    files: list[MediaFile] = field(default_factory=list)


def to_data_url(data: bytes, mime: str) -> str:
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def decode_data_url(url: str) -> tuple[bytes, str] | None:
    match = _DATA_URL_RE.match(url.strip())
    if not match:
        return None
    mime = match.group(1).lower()
    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=False)
    except Exception:  # noqa: BLE001
        return None
    return raw, mime


def normalize_image_bytes(data: bytes, mime: str | None = None) -> tuple[bytes, str] | None:
    """JPEG-compress and cap an image. Returns None when it is too small or unusable."""
    try:
        from PIL import Image
    except ImportError:
        if mime and mime.startswith("image/") and data:
            return data, mime
        return None

    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception:  # noqa: BLE001
        return None

    width, height = image.size
    if min(width, height) < MIN_EDGE:
        return None

    if image.mode in {"RGBA", "LA"} or (image.mode == "P" and "transparency" in image.info):
        background = Image.new("RGB", image.size, (255, 255, 255))
        rgba = image.convert("RGBA")
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")

    longest = max(width, height)
    if longest > MAX_EDGE:
        ratio = MAX_EDGE / longest
        image = image.resize(
            (max(1, int(width * ratio)), max(1, int(height * ratio))),
            Image.Resampling.LANCZOS,
        )

    if (
        (mime or "").lower() == "image/jpeg"
        and longest <= MAX_EDGE
        and len(data) <= MAX_BYTES
        and min(width, height) >= MIN_EDGE
    ):
        return data, "image/jpeg"

    for quality in (JPEG_QUALITY, 60, 40):
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=quality, optimize=True)
        out = buffer.getvalue()
        if len(out) <= MAX_BYTES:
            return out, "image/jpeg"
    return None


def count_embedded_images(markdown: str) -> int:
    if not markdown:
        return 0
    return len(_IMAGE_MARKUP_RE.findall(markdown))


def protect_embedded_images(markdown: str) -> tuple[str, list[str]]:
    """Replace image markup with short placeholders so other text transforms stay safe."""
    held: list[str] = []

    def stash(match: re.Match[str]) -> str:
        held.append(match.group(0))
        return f"@@FWIMG{len(held) - 1}@@"

    return _IMAGE_MARKUP_RE.sub(stash, markdown), held


def restore_embedded_images(markdown: str, held: list[str], *, drop_missing: bool = True) -> str:
    def replace(match: re.Match[str]) -> str:
        index = int(match.group(1))
        if 0 <= index < len(held):
            return held[index]
        return "" if drop_missing else match.group(0)

    return _PLACEHOLDER_RE.sub(replace, markdown)


def place_images(
    markdown: str,
    images: list[EmbeddedImage],
    *,
    budget: int = MAX_IMAGES,
) -> str:
    """Insert compressed images at existing refs / alt-text / page breaks, else an appendix."""
    cap = max(0, budget)
    if not images or not cap:
        return markdown
    prepared: list[tuple[EmbeddedImage, str]] = []
    for image in images:
        if len(prepared) >= cap:
            break
        normalized = normalize_image_bytes(image.data, image.mime)
        if normalized is None:
            logger.info("Skipping unreadable or tiny image alt=%r mime=%s", image.alt, image.mime)
            continue
        data, mime = normalized
        alt = (image.alt or "").strip() or "image"
        prepared.append((image, _image_markup(image, alt, to_data_url(data, mime))))
    if not prepared:
        return markdown

    md = markdown or ""
    md, leftover = _fill_existing_image_refs(md, prepared)
    used = len(prepared) - len(leftover)
    remaining: list[tuple[EmbeddedImage, str]] = []
    for image, snippet in leftover:
        if used >= cap:
            break
        alt = (image.alt or "").strip() or "image"
        placed = _replace_alt_hook(md, alt, snippet)
        if placed is not None:
            md = placed
            used += 1
        else:
            remaining.append((image, snippet))

    leftover: list[tuple[EmbeddedImage, str]] = []
    placed_any = False
    for image, snippet in remaining:
        if used >= cap:
            leftover.append((image, snippet))
            continue
        next_md = _insert_near_page(md, image, snippet)
        if next_md is not None:
            md = next_md
            used += 1
            placed_any = True
        else:
            leftover.append((image, snippet))

    chunks = re.split(r"\n\n---\n\n", md)
    by_page: dict[int, list[str]] = {}
    still: list[tuple[EmbeddedImage, str]] = []
    for image, snippet in leftover:
        if used >= cap:
            break
        if image.page and 1 <= image.page <= len(chunks) and len(chunks) > 1:
            by_page.setdefault(image.page, []).append(snippet)
            used += 1
        else:
            still.append((image, snippet))
    leftover = still

    if by_page:
        for page, snippets in by_page.items():
            chunks[page - 1] = chunks[page - 1].rstrip() + "\n\n" + "\n\n".join(snippets)
        md = "\n\n---\n\n".join(chunks)

    leftover = leftover[: max(0, cap - used)]
    if leftover:
        groups: dict[int | None, list[str]] = {}
        for image, snippet in leftover:
            groups.setdefault(image.page, []).append(snippet)
        parts = ["## Embedded images\n"]
        for page in sorted(groups, key=lambda value: (value is None, value or 0)):
            snippets = groups[page]
            if page:
                parts.append(f"### Page {page}\n\n" + "\n\n".join(snippets))
            else:
                parts.append("\n\n".join(snippets))
        appendix = "\n\n".join(parts).strip() + "\n"
        md = (
            _insert_visible_appendix(md, appendix)
            if not placed_any
            else (md.rstrip() + "\n\n" + appendix)
        )
    return md


def normalize_embedded_images(markdown: str, *, budget: int = MAX_IMAGES) -> str:
    """Recompress existing data URLs and drop anything past the cap."""
    if not markdown:
        return markdown
    allowed = max(0, budget)
    count = 0

    def next_url(src: str) -> str | None:
        nonlocal count
        decoded = decode_data_url(src)
        if not decoded:
            return src
        if count >= allowed:
            return None
        normalized = normalize_image_bytes(decoded[0], decoded[1])
        if normalized is None:
            return None
        count += 1
        return to_data_url(normalized[0], normalized[1])

    def md_replace(match: re.Match[str]) -> str:
        alt, src = match.group(1), match.group(2).strip()
        if not src.lower().startswith("data:image"):
            return match.group(0)
        url = next_url(src)
        if url is None:
            label = alt.strip() or "image"
            return f"*{label} omitted (image limit)*"
        return _md_image(alt, url, match.group(3))

    def html_replace(match: re.Match[str]) -> str:
        pre, _quote, src, post = match.group(1), match.group(2), match.group(3), match.group(4)
        if not src.lower().startswith("data:image"):
            return match.group(0)
        url = next_url(src)
        if url is None:
            return "*image omitted (image limit)*"
        alt = _alt_from_html_attrs(pre, post)
        return _md_image(alt, url, _size_title_from_html_attrs(pre, post))

    text = _MD_IMG_RE.sub(md_replace, markdown)
    return _HTML_IMG_RE.sub(html_replace, text)


def extract_pdf_images(path: Path) -> list[EmbeddedImage]:
    """Pull embedded XObject bitmaps from a text PDF (not full-page raster)."""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        logger.warning("pypdfium2 is not installed; skipping PDF image extract")
        return []

    images: list[EmbeddedImage] = []
    seen: set[str] = set()
    try:
        document = pdfium.PdfDocument(str(path))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to open PDF for image extract: %s", exc)
        return []

    try:
        page_count = len(document)
        for page_index, page in enumerate(document):
            try:
                page_size = page.get_size()
            except Exception:  # noqa: BLE001
                page_size = (612.0, 792.0)
            hint = None
            try:
                textpage = page.get_textpage()
                hint = _page_hint_from_text(textpage.get_text_bounded() or "")
                textpage.close()
            except Exception:  # noqa: BLE001
                hint = None
            try:
                objects = page.get_objects(filter=[pdfium.raw.FPDF_PAGEOBJ_IMAGE])
            except Exception:  # noqa: BLE001
                page.close()
                continue
            for obj in objects:
                if len(images) >= MAX_IMAGES:
                    break
                extracted = _pdf_object_to_image(
                    obj,
                    page=page_index + 1,
                    page_size=page_size,
                    page_hint=hint,
                    page_count=page_count,
                )
                if extracted is None:
                    continue
                digest = hashlib.sha1(extracted.data).hexdigest()
                if digest in seen:
                    continue
                seen.add(digest)
                images.append(extracted)
            page.close()
            if len(images) >= MAX_IMAGES:
                break
    finally:
        document.close()
    logger.info("Extracted %s unique PDF image(s) from %s", len(images), path.name)
    return images


def _is_page_dict(page: Any) -> bool:
    return isinstance(page, dict) and isinstance(page.get("markdown"), str)


def _scatter_pages(
    markdown: str,
    pages: list[dict[str, Any]],
    indices: list[int],
) -> list[dict[str, Any]]:
    """Push a joined, image-placed document back onto the pages it came from."""
    chunks = markdown.split(PAGE_SEPARATOR)
    if len(chunks) != len(indices):
        return pages
    updated = list(pages)
    for index, chunk in zip(indices, chunks):
        updated[index] = {**updated[index], "markdown": chunk}
    return updated


def _embedded_data_url_digests(markdown: str) -> set[str]:
    found: set[str] = set()
    for match in _DATA_URL_RE.finditer(markdown or ""):
        try:
            raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=False)
        except Exception:  # noqa: BLE001
            continue
        if raw:
            found.add(hashlib.sha1(raw).hexdigest())
    return found


def _missing_source_images(
    markdown: str,
    source: SourceFile,
    *,
    preserve_images: bool,
) -> list[EmbeddedImage]:
    """Images the reader dropped: the raster itself, or the PDF's XObjects."""
    if not preserve_images:
        return []
    if source.is_image:
        if "data:image" in markdown.lower():
            return []
        raster = _source_raster_image(source)
        return [raster] if raster is not None else []
    if source.suffix == ".pdf":
        images = extract_pdf_images(source.path)
        seen = _embedded_data_url_digests(markdown)
        return [image for image in images if hashlib.sha1(image.data).hexdigest() not in seen]
    return []


def _place_on_pages(
    pages: list[dict[str, Any]],
    indices: list[int],
    images: list[EmbeddedImage],
    used: int,
) -> tuple[list[dict[str, Any]], int, list[EmbeddedImage]]:
    """Place each image inside its own page, so it cannot drift into another page's base64."""
    by_page: dict[Any, list[EmbeddedImage]] = {}
    for image in images:
        by_page.setdefault(image.page, []).append(image)
    updated = list(pages)
    for index in indices:
        mine = by_page.pop(updated[index].get("page"), [])
        if not mine:
            continue
        before = str(updated[index]["markdown"])
        placed = place_images(before, mine, budget=max(0, MAX_IMAGES - used))
        used += count_embedded_images(placed) - count_embedded_images(before)
        updated[index] = {**updated[index], "markdown": placed}
    leftover = [image for group in by_page.values() for image in group]
    return updated, used, leftover


def embed_read_result_media(
    result: ReadResult,
    source: SourceFile,
    *,
    preserve_images: bool = True,
) -> ReadResult:
    """Pipeline hook: source raster / PDF XObjects when missing, then compress/cap.

    ``preserve_images`` (default on) keeps original charts and figures from text
    PDFs on the page they came from, next to the extracted text.
    """
    original = result.markdown() or ""
    multi_page = (
        result.page_count > 1
        and bool(result.pages)
        and all(_is_page_dict(page) for page in result.pages)
    )

    # Recompress what the reader already embedded, sharing one image budget.
    used = 0
    pages: list[dict[str, Any]] = []
    for page in result.pages:
        if not _is_page_dict(page):
            pages.append(page)
            continue
        page_md = str(page["markdown"])
        if not multi_page and page_md == original:
            pages.append(page)
            continue
        normalized = normalize_embedded_images(page_md, budget=max(0, MAX_IMAGES - used))
        used += count_embedded_images(normalized)
        pages.append({**page, "markdown": normalized})

    # Multi-page readers own the text; the join is only used to test for existing images.
    filled: list[int] = []
    if multi_page:
        filled = [index for index, page in enumerate(pages) if str(page["markdown"]).strip()]
    if filled:
        base = PAGE_SEPARATOR.join(str(pages[index]["markdown"]) for index in filled).strip()
    else:
        base_budget = max(0, MAX_IMAGES - used) if used else MAX_IMAGES
        base = normalize_embedded_images(original, budget=base_budget)

    extra = _missing_source_images(base, source, preserve_images=preserve_images)
    budget = max(0, MAX_IMAGES - used) if used else MAX_IMAGES

    if filled:
        pages, used, leftover = _place_on_pages(pages, filled, extra, used)
        markdown = PAGE_SEPARATOR.join(str(pages[index]["markdown"]) for index in filled).strip()
        if leftover:
            markdown = place_images(markdown, leftover, budget=max(0, MAX_IMAGES - used))
            pages = _scatter_pages(markdown, pages, filled)
    else:
        markdown = place_images(base, extra, budget=budget)
        pages = [
            {**page, "markdown": markdown}
            if _is_page_dict(page) and page["markdown"] == original
            else page
            for page in pages
        ]

    metadata = {"embedded_images": count_embedded_images(markdown)}
    return result.with_markdown(markdown, pages=pages, metadata_extra=metadata)


def fold_embedded_media(
    markdown: str | None,
    json_data: Any,
    pages: list[dict[str, Any]] | None,
) -> FoldedPayload:
    """Swap data URLs for ``media/n.jpg`` refs. Same bytes share one file."""
    files: list[MediaFile] = []
    digest_to_name: dict[str, str] = {}

    def fold_text(text: str | None) -> str | None:
        if not text:
            return text
        return _fold_text(text, files, digest_to_name)

    folded_pages: list[dict[str, Any]] = []
    for page in pages or []:
        if isinstance(page, dict) and isinstance(page.get("markdown"), str):
            folded_pages.append({**page, "markdown": fold_text(page["markdown"]) or ""})
        else:
            folded_pages.append(page)

    folded_json = json_data
    if isinstance(json_data, dict) and isinstance(json_data.get("text"), str):
        folded_json = {**json_data, "text": fold_text(json_data["text"])}

    return FoldedPayload(
        markdown=fold_text(markdown),
        json_data=folded_json,
        pages=folded_pages,
        files=files,
    )


def expand_embedded_media(
    markdown: str | None,
    json_data: Any,
    pages: list[dict[str, Any]] | None,
    files: dict[str, bytes],
) -> tuple[str | None, Any, list[dict[str, Any]]]:
    """Restore ``media/n.jpg`` refs to data URLs. Legacy data URLs are left as-is."""

    def expand_text(text: str | None) -> str | None:
        if not text:
            return text
        return _expand_text(text, files)

    expanded_pages: list[dict[str, Any]] = []
    for page in pages or []:
        if isinstance(page, dict) and isinstance(page.get("markdown"), str):
            expanded_pages.append({**page, "markdown": expand_text(page["markdown"]) or ""})
        else:
            expanded_pages.append(page)

    expanded_json = json_data
    if isinstance(json_data, dict) and isinstance(json_data.get("text"), str):
        expanded_json = {**json_data, "text": expand_text(json_data["text"])}

    return expand_text(markdown), expanded_json, expanded_pages


def _md_image(alt: str, url: str, title: str | None = None) -> str:
    if title:
        return f'![{alt}]({url} "{title}")'
    return f"![{alt}]({url})"


def _alt_from_html_attrs(pre: str, post: str) -> str:
    match = re.search(r'\balt\s*=\s*([\'"])(.*?)\1', f"{pre} {post}", flags=re.I | re.DOTALL)
    return (match.group(2) if match else "").strip() or "image"


def _size_title_from_html_attrs(pre: str, post: str) -> str | None:
    blob = f"{pre} {post}"
    width = re.search(r'\bwidth\s*=\s*([\'"]?)(\d+)\1', blob, flags=re.I)
    height = re.search(r'\bheight\s*=\s*([\'"]?)(\d+)\1', blob, flags=re.I)
    if width and height:
        return f"{width.group(2)}x{height.group(2)}"
    return None


def _snippet_url(snippet: str) -> str:
    match = _MD_IMG_RE.search(snippet)
    if match:
        return match.group(2).strip()
    html = _HTML_IMG_RE.search(snippet)
    if html:
        return html.group(3).strip()
    return ""


def _is_remote_or_embedded(src: str) -> bool:
    value = src.strip()
    return value.startswith(("data:", "http://", "https://", "blob:", f"{MEDIA_DIR}/"))


def _fill_existing_image_refs(
    markdown: str,
    prepared: list[tuple[EmbeddedImage, str]],
) -> tuple[str, list[tuple[EmbeddedImage, str]]]:
    """Replace broken local ``![](imgs/…)`` / ``<img src>`` refs with data URLs, in order."""
    leftover = list(prepared)

    def md_replace(match: re.Match[str]) -> str:
        alt, src = match.group(1), match.group(2).strip()
        if _is_remote_or_embedded(src) or not leftover:
            return match.group(0)
        _image, snippet = leftover.pop(0)
        url = _snippet_url(snippet)
        return _md_image(alt, url, match.group(3)) if url else snippet

    def html_replace(match: re.Match[str]) -> str:
        pre, _quote, src, post = match.group(1), match.group(2), match.group(3), match.group(4)
        if _is_remote_or_embedded(src) or not leftover:
            return match.group(0)
        _image, snippet = leftover.pop(0)
        url = _snippet_url(snippet)
        if not url:
            return match.group(0)
        return _md_image(
            _alt_from_html_attrs(pre, post), url, _size_title_from_html_attrs(pre, post)
        )

    text = _MD_IMG_RE.sub(md_replace, markdown)
    text = _HTML_IMG_RE.sub(html_replace, text)
    return text, leftover


def _image_markup(image: EmbeddedImage, alt: str, data_url: str) -> str:
    return _md_image(alt, data_url, _layout_title(image))


def _layout_title(image: EmbeddedImage) -> str | None:
    """PDF on-page width in CSS px, plus optional left/right float for letterheads."""
    parts: list[str] = []
    if image.display_width:
        parts.append(str(max(24, image.display_width)))
    y_frac = image.y_frac
    x_frac = image.x_frac
    if y_frac is not None and y_frac < 0.35:
        parts.append("right" if (x_frac or 0) >= 0.5 else "left")
    elif x_frac is not None and x_frac >= 0.55:
        parts.append("right")
    return " ".join(parts) or None


def _page_hint_from_text(text: str) -> str | None:
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.replace("\r", "\n").split("\n")]
    lines = [line for line in lines if len(line) >= 18]
    skip_prefix = ("page ", "http://", "https://", "www.")
    for line in lines:
        lower = line.lower()
        if lower.startswith(skip_prefix) or lower in {"farmers.com"}:
            continue
        return line[:90]
    return lines[0][:90] if lines else None


def _find_hint_index(markdown: str, hint: str) -> int:
    hint = hint.strip()
    if not hint:
        return -1
    idx = markdown.find(hint)
    if idx >= 0:
        return idx
    for size in (28, 18, 12):
        needle = hint[:size].strip()
        if len(needle) < 8:
            continue
        idx = markdown.find(needle)
        if idx >= 0:
            return idx
    words = re.sub(r"\s+", " ", hint).split()
    if len(words) >= 3:
        piece = " ".join(words[:3])
        idx = markdown.find(piece)
        if idx >= 0:
            return idx
    return -1


def _insert_near_page(markdown: str, image: EmbeddedImage, snippet: str) -> str | None:
    idx = _find_hint_index(markdown, image.page_hint or "")
    if idx >= 0:
        at_end = (image.x_frac or 0) >= 0.5 or (image.y_frac or 0) >= 0.4
        return _insert_on_same_line(markdown, idx, snippet, at_end=at_end)
    if image.page and image.page_count and image.page_count > 1:
        frac = (image.page - 1) / image.page_count
        pos = max(0, min(len(markdown), int(len(markdown) * frac)))
        snapped = markdown.find("\n", pos)
        pos = snapped if snapped >= 0 else pos
        return _insert_on_same_line(markdown, max(0, pos - 1), snippet, at_end=True)
    return None


def _insert_on_same_line(markdown: str, idx: int, snippet: str, *, at_end: bool) -> str:
    line_start = markdown.rfind("\n", 0, max(idx, 0)) + 1
    line_end = markdown.find("\n", idx if idx >= 0 else 0)
    if line_end < 0:
        line_end = len(markdown)
    line = markdown[line_start:line_end]
    if snippet in line:
        return markdown
    if at_end:
        new_line = line.rstrip() + " " + snippet
    else:
        new_line = snippet + " " + line.lstrip()
    return markdown[:line_start] + new_line + markdown[line_end:]


def _insert_visible_appendix(markdown: str, appendix: str) -> str:
    """Put leftover figures at the top so they are not buried after tens of pages of text."""
    body = (markdown or "").strip()
    block = appendix.strip()
    if not body:
        return block + "\n"
    return f"{block}\n\n{body}\n"


def _source_raster_image(source: SourceFile) -> EmbeddedImage | None:
    try:
        data = source.path.read_bytes()
    except OSError:
        return None
    normalized = normalize_image_bytes(data)
    if normalized is None:
        return None
    out, mime = normalized
    alt = Path(source.filename).stem or "image"
    return EmbeddedImage(alt=alt, data=out, mime=mime)


def _replace_alt_hook(markdown: str, alt: str, snippet: str) -> str | None:
    if not alt or alt == "image":
        return None
    escaped = re.escape(alt)
    patterns = (
        rf"(?m)^!\[{escaped}\]\((?!data:|media/)[^)]+\)\s*$",
        rf"(?m)^(?:\*{escaped}\*|\[{escaped}\]|{escaped})\s*$",
    )
    for pattern in patterns:
        updated, count = re.subn(pattern, snippet, markdown, count=1)
        if count:
            return updated
    token = f"![{alt}]("
    if token in markdown:
        return None
    match = re.search(rf"(?<!\[){escaped}(?!\])", markdown)
    if not match:
        return None
    # Insert after the paragraph that first mentions the alt text.
    line_end = markdown.find("\n", match.end())
    if line_end < 0:
        return markdown + "\n\n" + snippet
    return markdown[:line_end] + "\n\n" + snippet + markdown[line_end:]


def _pdf_object_to_image(
    obj: Any,
    page: int,
    *,
    page_size: tuple[float, float] | None = None,
    page_hint: str | None = None,
    page_count: int | None = None,
) -> EmbeddedImage | None:
    display_width = display_height = None
    y_frac = None
    x_frac = None
    try:
        bounds = obj.get_bounds()
        left, bottom, right, top = (
            float(bounds[0]),
            float(bounds[1]),
            float(bounds[2]),
            float(bounds[3]),
        )
        disp_w = abs(right - left)
        disp_h = abs(top - bottom)
        page_w, page_h = page_size or (612.0, 792.0)
        if max(disp_w, disp_h) < MIN_DISPLAY_PT:
            return None
        page_area = page_w * page_h
        if page_area > 0 and (disp_w * disp_h) / page_area > FULL_PAGE_AREA:
            return None
        if page_w > 0 and page_h > 0 and disp_w > 0.85 * page_w and disp_h > 0.4 * page_h:
            return None
        css_w = max(1, round(disp_w * 96 / 72))
        css_h = max(1, round(disp_h * 96 / 72))
        display_width = css_w
        display_height = css_h
        y_frac = 1.0 - (max(bottom, top) / page_h) if page_h else 0.5
        y_frac = min(1.0, max(0.0, y_frac))
        x_frac = min(left, right) / page_w if page_w else 0.0
        x_frac = min(1.0, max(0.0, x_frac))
    except Exception:  # noqa: BLE001
        pass

    try:
        size = obj.get_px_size()
        width, height = int(size[0]), int(size[1])
        if min(width, height) < MIN_EDGE:
            return None
    except Exception:  # noqa: BLE001
        pass

    data, mime = _pdf_object_bytes(obj)
    if not data:
        return None
    normalized = normalize_image_bytes(data, mime)
    if normalized is None:
        return None
    out, out_mime = normalized
    return EmbeddedImage(
        alt=f"page-{page}-image",
        data=out,
        mime=out_mime,
        page=page,
        display_width=display_width,
        display_height=display_height,
        y_frac=y_frac,
        x_frac=x_frac,
        page_hint=page_hint,
        page_count=page_count,
    )


def _pdf_object_bytes(obj: Any) -> tuple[bytes | None, str | None]:
    """Prefer the stored bitmap so page-scale rendering does not crop or shrink it."""
    try:
        raw = obj.get_data()
        if raw:
            data = bytes(raw)
            if data.startswith(b"\xff\xd8\xff") or data.startswith(b"\x89PNG\r\n\x1a\n"):
                mime = "image/jpeg" if data.startswith(b"\xff\xd8\xff") else "image/png"
                return data, mime
    except Exception:  # noqa: BLE001
        pass

    pil = None
    for kwargs in ({"render": False}, {"render": True}, {}):
        bitmap = None
        try:
            bitmap = obj.get_bitmap(**kwargs) if kwargs else obj.get_bitmap()
            pil = bitmap.to_pil()
            if pil is not None:
                break
        except Exception:  # noqa: BLE001
            pil = None
        finally:
            if bitmap is not None:
                try:
                    bitmap.close()
                except Exception:  # noqa: BLE001
                    pass
        if pil is not None:
            break
    if pil is None:
        return None, None
    buffer = io.BytesIO()
    try:
        rgb = pil.convert("RGB") if pil.mode != "RGB" else pil
        rgb.save(buffer, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        return buffer.getvalue(), "image/jpeg"
    except Exception:  # noqa: BLE001
        return None, None


def _fold_text(text: str, files: list[MediaFile], digest_to_name: dict[str, str]) -> str:
    def store(url: str) -> str | None:
        decoded = decode_data_url(url)
        if not decoded:
            return None
        raw, mime = decoded
        digest = hashlib.sha1(raw).hexdigest()
        if digest in digest_to_name:
            return digest_to_name[digest]
        ext = (
            "jpg" if mime == "image/jpeg" else mime.split("/", 1)[-1].lower().replace("jpeg", "jpg")
        )
        if ext not in {"jpg", "jpeg", "png", "gif", "webp"}:
            ext = "jpg"
        name = f"{len(files)}.{ext}"
        content_type = "image/jpeg" if ext in {"jpg", "jpeg"} else f"image/{ext}"
        files.append(MediaFile(name=name, data=raw, content_type=content_type))
        digest_to_name[digest] = name
        return name

    def md_replace(match: re.Match[str]) -> str:
        alt, src = match.group(1), match.group(2).strip()
        if not src.lower().startswith("data:image"):
            return match.group(0)
        name = store(src)
        if not name:
            return match.group(0)
        return _md_image(alt, f"{MEDIA_DIR}/{name}", match.group(3))

    def html_replace(match: re.Match[str]) -> str:
        pre, _quote, src, post = match.group(1), match.group(2), match.group(3), match.group(4)
        if not src.lower().startswith("data:image"):
            return match.group(0)
        name = store(src)
        if not name:
            return match.group(0)
        return _md_image(
            _alt_from_html_attrs(pre, post),
            f"{MEDIA_DIR}/{name}",
            _size_title_from_html_attrs(pre, post),
        )

    text = _MD_IMG_RE.sub(md_replace, text)
    return _HTML_IMG_RE.sub(html_replace, text)


def _expand_text(text: str, files: dict[str, bytes]) -> str:
    if not files:
        return text

    def lookup(src: str) -> str | None:
        cleaned = src.strip().strip("'\"")
        if not cleaned.startswith(f"{MEDIA_DIR}/"):
            return None
        name = cleaned.split("/", 1)[-1]
        if not _MEDIA_NAME_RE.match(name):
            return None
        data = files.get(name)
        if not data:
            return None
        ext = name.rsplit(".", 1)[-1].lower()
        mime = "image/jpeg" if ext in {"jpg", "jpeg"} else f"image/{ext}"
        return to_data_url(data, mime)

    def md_replace(match: re.Match[str]) -> str:
        alt, src = match.group(1), match.group(2)
        url = lookup(src)
        if not url:
            return match.group(0)
        return _md_image(alt, url, match.group(3))

    def html_replace(match: re.Match[str]) -> str:
        pre, _quote, src, post = match.group(1), match.group(2), match.group(3), match.group(4)
        url = lookup(src)
        if not url:
            return match.group(0)
        return _md_image(
            _alt_from_html_attrs(pre, post),
            url,
            _size_title_from_html_attrs(pre, post),
        )

    text = _MD_IMG_RE.sub(md_replace, text)
    return _HTML_IMG_RE.sub(html_replace, text)
