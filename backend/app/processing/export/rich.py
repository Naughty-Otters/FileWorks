"""DOCX and raster image exporters (Markdown / source → download bytes)."""

from __future__ import annotations

import base64
import io
import logging
import re
from pathlib import Path

from app.processing.export.base import FormatExporter
from app.processing.export.formats import strip_markdown
from app.processing.models import ExportArtifact, OutputKind, ReadResult

logger = logging.getLogger(__name__)

_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}
_DATA_IMAGE = re.compile(
    r"!\[([^\]]*)\]\((data:image/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=\s]+))\)",
    re.IGNORECASE,
)
_HEADING = re.compile(r"^(#{1,6})\s+(.*)$")
_UL = re.compile(r"^[-*+]\s+(.*)$")
_OL = re.compile(r"^(\d+)[.)]\s+(.*)$")
_FENCE = re.compile(r"^```")
_INLINE = re.compile(r"(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)")


def _decode_data_image(b64: str) -> bytes | None:
    try:
        return base64.b64decode(re.sub(r"\s+", "", b64), validate=False)
    except Exception:  # noqa: BLE001
        return None


def markdown_to_docx(markdown: str, *, title: str = "document") -> bytes:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.oxml.ns import qn
    from docx.shared import Inches, Pt, RGBColor

    doc = Document()
    section = doc.sections[0]
    section.top_margin = Inches(0.85)
    section.bottom_margin = Inches(0.85)
    section.left_margin = Inches(1.0)
    section.right_margin = Inches(1.0)
    style = doc.styles["Normal"]
    style.font.name = "Calibri"
    style.font.size = Pt(11)
    try:
        style.element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")
    except Exception:  # noqa: BLE001
        pass

    lines = (markdown or "").replace("\r\n", "\n").split("\n")
    i = 0
    in_fence = False
    code_lines: list[str] = []

    def flush_code() -> None:
        nonlocal code_lines
        if not code_lines:
            return
        para = doc.add_paragraph()
        run = para.add_run("\n".join(code_lines))
        run.font.name = "Consolas"
        run.font.size = Pt(10)
        run.font.color.rgb = RGBColor(0x1A, 0x1A, 0x1A)
        para.paragraph_format.space_after = Pt(10)
        code_lines = []

    def add_styled(paragraph, text: str) -> None:
        for part in _INLINE.split(text):
            if not part:
                continue
            if part.startswith("**") and part.endswith("**") and len(part) >= 4:
                run = paragraph.add_run(part[2:-2])
                run.bold = True
            elif part.startswith("*") and part.endswith("*") and len(part) >= 2:
                run = paragraph.add_run(part[1:-1])
                run.italic = True
            elif part.startswith("`") and part.endswith("`") and len(part) >= 2:
                run = paragraph.add_run(part[1:-1])
                run.font.name = "Consolas"
                run.font.size = Pt(10)
            else:
                paragraph.add_run(part)

    while i < len(lines):
        line = lines[i]
        if _FENCE.match(line.strip()):
            if in_fence:
                flush_code()
                in_fence = False
            else:
                in_fence = True
            i += 1
            continue
        if in_fence:
            code_lines.append(line)
            i += 1
            continue

        heading = _HEADING.match(line)
        if heading:
            level = min(len(heading.group(1)), 4)
            para = doc.add_heading(heading.group(2).strip(), level=level)
            para.alignment = WD_ALIGN_PARAGRAPH.LEFT
            i += 1
            continue

        if line.strip().startswith("|") and i + 1 < len(lines) and re.search(r"\|?\s*-{3,}", lines[i + 1]):
            rows: list[list[str]] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                raw = lines[i].strip()
                if re.match(r"^\|?\s*[-:| ]+\|?$", raw):
                    i += 1
                    continue
                cells = [c.strip() for c in raw.strip("|").split("|")]
                rows.append(cells)
                i += 1
            if rows:
                cols = max(len(r) for r in rows)
                table = doc.add_table(rows=len(rows), cols=cols)
                table.style = "Table Grid"
                for r_i, row in enumerate(rows):
                    for c_i in range(cols):
                        table.rows[r_i].cells[c_i].text = row[c_i] if c_i < len(row) else ""
                doc.add_paragraph()
            continue

        img = _DATA_IMAGE.search(line)
        if img:
            payload = _decode_data_image(img.group(4))
            if payload:
                stream = io.BytesIO(payload)
                try:
                    doc.add_picture(stream, width=Inches(5.5))
                except Exception:  # noqa: BLE001
                    doc.add_paragraph(img.group(1) or "[image]")
            i += 1
            continue

        ul = _UL.match(line)
        if ul:
            para = doc.add_paragraph(style="List Bullet")
            add_styled(para, ul.group(1))
            i += 1
            continue
        ol = _OL.match(line)
        if ol:
            para = doc.add_paragraph(style="List Number")
            add_styled(para, ol.group(2))
            i += 1
            continue

        if not line.strip():
            i += 1
            continue
        para = doc.add_paragraph()
        add_styled(para, line.strip())
        i += 1

    flush_code()
    if not doc.paragraphs:
        doc.add_paragraph(title)

    buffer = io.BytesIO()
    doc.save(buffer)
    return buffer.getvalue()


def _load_font(size: int):
    from PIL import ImageFont

    candidates = (
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    )
    for path in candidates:
        if Path(path).is_file():
            try:
                return ImageFont.truetype(path, size=size)
            except OSError:
                continue
    return ImageFont.load_default()


def _stack_images(images: list, *, gap: int = 16, bg=(255, 255, 255)):
    from PIL import Image

    if not images:
        raise ValueError("No images to stack")
    width = max(im.width for im in images)
    height = sum(im.height for im in images) + gap * (len(images) - 1)
    canvas = Image.new("RGB", (width, height), bg)
    y = 0
    for im in images:
        if im.mode != "RGB":
            im = im.convert("RGB")
        x = (width - im.width) // 2
        canvas.paste(im, (x, y))
        y += im.height + gap
    return canvas


def _rasterize_pdf(source_bytes: bytes, *, max_pages: int = 12, scale: float = 1.6):
    import pypdfium2 as pdfium
    from PIL import Image

    document = pdfium.PdfDocument(source_bytes)
    pages: list[Image.Image] = []
    try:
        count = min(len(document), max_pages)
        for index in range(count):
            page = document[index]
            bitmap = page.render(scale=scale)
            pages.append(bitmap.to_pil().convert("RGB"))
            page.close()
    finally:
        document.close()
    return pages


def _open_source_image(source_bytes: bytes):
    from PIL import Image

    image = Image.open(io.BytesIO(source_bytes))
    image.load()
    return image.convert("RGB")


def _wrap_text(text: str, font, max_width: int, draw) -> list[str]:
    lines: list[str] = []
    for raw in text.split("\n"):
        words = raw.split(" ")
        current = ""
        for word in words:
            trial = word if not current else f"{current} {word}"
            if draw.textlength(trial, font=font) <= max_width:
                current = trial
            else:
                if current:
                    lines.append(current)
                current = word
        lines.append(current)
    return lines or [""]


def _render_markdown_image(markdown: str) -> object:
    from PIL import Image, ImageDraw

    width = 960
    padding = 48
    font = _load_font(18)
    heading_font = _load_font(28)
    text = strip_markdown(markdown or "") or "Converted document"
    probe = Image.new("RGB", (width, 100), (255, 255, 255))
    draw = ImageDraw.Draw(probe)
    wrapped = _wrap_text(text, font, width - padding * 2, draw)
    line_h = 26
    extra: list[Image.Image] = []
    for match in _DATA_IMAGE.finditer(markdown or ""):
        payload = _decode_data_image(match.group(4))
        if not payload:
            continue
        try:
            im = Image.open(io.BytesIO(payload)).convert("RGB")
            max_w = width - padding * 2
            if im.width > max_w:
                ratio = max_w / im.width
                im = im.resize((max_w, max(1, int(im.height * ratio))), Image.Resampling.LANCZOS)
            extra.append(im)
        except Exception:  # noqa: BLE001
            continue
        if len(extra) >= 4:
            break

    text_h = max(120, padding * 2 + len(wrapped) * line_h + 40)
    img_h = sum(im.height + 16 for im in extra)
    canvas = Image.new("RGB", (width, text_h + img_h), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    draw.text((padding, padding), wrapped[0][:80] if wrapped else "Document", font=heading_font, fill=(26, 26, 26))
    y = padding + 44
    for line in wrapped[:80]:
        draw.text((padding, y), line, font=font, fill=(40, 40, 40))
        y += line_h
    for im in extra:
        canvas.paste(im, (padding, y))
        y += im.height + 16
    return canvas


def render_document_image(
    markdown: str,
    *,
    image_format: str,
    source_bytes: bytes | None = None,
    source_suffix: str | None = None,
) -> bytes:
    from PIL import Image

    suffix = (source_suffix or "").lower()
    image: Image.Image | None = None
    if source_bytes and suffix == ".pdf":
        try:
            pages = _rasterize_pdf(source_bytes)
            if pages:
                image = _stack_images(pages)
        except Exception:  # noqa: BLE001
            logger.exception("PDF rasterize failed; falling back to Markdown preview")
    elif source_bytes and suffix in _IMAGE_SUFFIXES:
        try:
            image = _open_source_image(source_bytes)
        except Exception:  # noqa: BLE001
            logger.exception("Image convert failed; falling back to Markdown preview")
    if image is None:
        image = _render_markdown_image(markdown)

    max_side = 2400
    w, h = image.size
    longest = max(w, h)
    if longest > max_side:
        ratio = max_side / longest
        image = image.resize((max(1, int(w * ratio)), max(1, int(h * ratio))), Image.Resampling.LANCZOS)

    buffer = io.BytesIO()
    fmt = "JPEG" if image_format.lower() in {"jpeg", "jpg"} else "PNG"
    if fmt == "JPEG":
        image.convert("RGB").save(buffer, format="JPEG", quality=85, optimize=True)
    else:
        image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


class DocxExporter(FormatExporter):
    id = "docx"
    label = "Word"
    aliases = ("word",)

    def can_export(self, source_kind: OutputKind = OutputKind.MARKDOWN) -> bool:
        return source_kind in {OutputKind.MARKDOWN, OutputKind.TEXT}

    def export(
        self,
        *,
        markdown: str,
        title: str = "document",
        read_result: ReadResult | None = None,
        source_bytes: bytes | None = None,
        source_suffix: str | None = None,
    ) -> ExportArtifact:
        del read_result, source_bytes, source_suffix
        return ExportArtifact(
            data=markdown_to_docx(markdown or "", title=title),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            extension="docx",
            format_id=self.id,
        )


class PngExporter(FormatExporter):
    id = "png"
    label = "PNG image"
    aliases = ()

    def can_export(self, source_kind: OutputKind = OutputKind.MARKDOWN) -> bool:
        return True

    def export(
        self,
        *,
        markdown: str,
        title: str = "document",
        read_result: ReadResult | None = None,
        source_bytes: bytes | None = None,
        source_suffix: str | None = None,
    ) -> ExportArtifact:
        del title, read_result
        return ExportArtifact(
            data=render_document_image(
                markdown or "",
                image_format="png",
                source_bytes=source_bytes,
                source_suffix=source_suffix,
            ),
            media_type="image/png",
            extension="png",
            format_id=self.id,
        )


class JpegExporter(FormatExporter):
    id = "jpeg"
    label = "JPEG image"
    aliases = ("jpg",)

    def can_export(self, source_kind: OutputKind = OutputKind.MARKDOWN) -> bool:
        return True

    def export(
        self,
        *,
        markdown: str,
        title: str = "document",
        read_result: ReadResult | None = None,
        source_bytes: bytes | None = None,
        source_suffix: str | None = None,
    ) -> ExportArtifact:
        del title, read_result
        return ExportArtifact(
            data=render_document_image(
                markdown or "",
                image_format="jpeg",
                source_bytes=source_bytes,
                source_suffix=source_suffix,
            ),
            media_type="image/jpeg",
            extension="jpg",
            format_id=self.id,
        )
