"""Firecrawl AnyDoc reader (office / PDF / CSV → Markdown)."""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

from app.processing.models import Capability, DocumentOutput, OutputKind, ReadResult, SourceFile
from app.processing.postprocess.media import EmbeddedImage, place_images
from app.processing.reading.anydoc_markdown import document_to_markdown
from app.processing.reading.base import Reader
from app.services.options import DEFAULT_EXTRACT_OPTIONS, ExtractOptions

logger = logging.getLogger(__name__)

SUPPORTED_SUFFIXES = frozenset(
    {
        ".doc",
        ".docx",
        ".docm",
        ".ppt",
        ".pps",
        ".pot",
        ".pptx",
        ".pptm",
        ".ppsx",
        ".ppsm",
        ".xls",
        ".xlsx",
        ".xlsm",
        ".xlsb",
        ".odt",
        ".ods",
        ".odp",
        ".rtf",
        ".epub",
        ".csv",
        ".pdf",
    }
)


def _ensure_vendor_path() -> None:
    vendor = Path(__file__).resolve().parents[3] / "vendor"
    if vendor.is_dir() and str(vendor) not in sys.path:
        sys.path.insert(0, str(vendor))


def import_anydoc() -> Any:
    _ensure_vendor_path()
    import anydoc

    return anydoc


def anydoc_is_available() -> bool:
    try:
        import_anydoc()
        return True
    except Exception:  # noqa: BLE001
        return False


def _markdown_looks_empty(markdown: str | None) -> bool:
    if not markdown or not markdown.strip():
        return True
    meaningful = [
        line.strip()
        for line in markdown.splitlines()
        if line.strip() and set(line.strip()) - {"-", "|", ":", " "}
    ]
    return len(meaningful) == 0


def _asset_bytes(asset: Any) -> bytes | None:
    data = getattr(asset, "data", None) or getattr(asset, "bytes", None)
    if data is None:
        return None
    if isinstance(data, memoryview):
        data = data.tobytes()
    if not isinstance(data, (bytes, bytearray)):
        return None
    return bytes(data)


def _iter_inlines(inlines: Any) -> Any:
    for inline in inlines or []:
        yield inline
        nested = getattr(inline, "content", None)
        if nested:
            yield from _iter_inlines(nested)


def _iter_blocks(blocks: Any) -> Any:
    for block in blocks or []:
        yield block
        content = getattr(block, "content", None)
        if content:
            yield from _iter_inlines(content)
        lst = getattr(block, "list", None)
        if lst is not None:
            for item in getattr(lst, "items", None) or []:
                yield from _iter_blocks(getattr(item, "blocks", None))
        table = getattr(block, "table", None)
        if table is not None:
            for row in getattr(table, "grid", None) or []:
                for slot in row or []:
                    cell = getattr(slot, "cell", None)
                    if cell is not None:
                        yield from _iter_blocks(getattr(cell, "blocks", None))
        nested_blocks = getattr(block, "blocks", None)
        if nested_blocks:
            yield from _iter_blocks(nested_blocks)


def _collect_document_images(document: Any) -> list[EmbeddedImage]:
    assets = list(getattr(document, "assets", None) or [])
    by_id: dict[int, Any] = {}
    for index, asset in enumerate(assets):
        asset_id = getattr(asset, "id", index)
        try:
            by_id[int(asset_id)] = asset
        except (TypeError, ValueError):
            by_id[index] = asset

    images: list[EmbeddedImage] = []
    seen: set[int] = set()

    def consider(inline: Any) -> None:
        if getattr(inline, "kind", None) != "image":
            return
        source = getattr(inline, "source", None)
        if source is None or getattr(source, "kind", None) != "asset":
            return
        asset_id = getattr(source, "asset_id", None)
        if asset_id is None:
            return
        try:
            key = int(asset_id)
        except (TypeError, ValueError):
            return
        asset = by_id.get(key)
        if asset is None:
            return
        media_type = str(getattr(asset, "media_type", None) or "")
        if not media_type.startswith("image/"):
            return
        data = _asset_bytes(asset)
        if not data:
            return
        alt = (getattr(inline, "alt", None) or "").strip() or f"image-{key}"
        images.append(EmbeddedImage(alt=alt, data=data, mime=media_type))
        seen.add(key)

    for node in _iter_blocks(getattr(document, "blocks", None)):
        if getattr(node, "kind", None) == "image":
            consider(node)
    for note in getattr(document, "notes", None) or []:
        for node in _iter_blocks(getattr(note, "blocks", None)):
            if getattr(node, "kind", None) == "image":
                consider(node)

    for index, asset in enumerate(assets):
        key = getattr(asset, "id", index)
        try:
            key_int = int(key)
        except (TypeError, ValueError):
            key_int = index
        if key_int in seen:
            continue
        media_type = str(getattr(asset, "media_type", None) or "")
        if not media_type.startswith("image/"):
            continue
        data = _asset_bytes(asset)
        if not data:
            continue
        alt = getattr(asset, "alt", None) or getattr(asset, "name", None) or f"image-{key_int}"
        images.append(EmbeddedImage(alt=str(alt), data=data, mime=media_type))
    return images


def _embed_assets_as_data_urls(markdown: str, document: Any) -> str:
    images = _collect_document_images(document)
    if not images:
        return markdown
    return place_images(markdown, images)


class AnyDocReader(Reader):
    id = "anydoc"
    label = "AnyDoc"
    priority = 10  # Prefer over OCR when capable

    def can_process(
        self,
        source: SourceFile,
        options: ExtractOptions | None = None,
    ) -> Capability:
        if not anydoc_is_available():
            return Capability.no("firecrawl-anydoc is not installed")
        if source.is_image:
            return Capability.no("AnyDoc does not process raster images; use OCR")
        if source.suffix not in SUPPORTED_SUFFIXES:
            return Capability.no(f"suffix {source.suffix} is outside AnyDoc formats")
        return Capability.yes(f"AnyDoc supports {source.suffix or 'detected format'}", confidence=0.9)

    def read(
        self,
        source: SourceFile,
        *,
        options: ExtractOptions | None = None,
        preferred_output: OutputKind = OutputKind.MARKDOWN,
    ) -> ReadResult:
        del preferred_output  # AnyDoc always yields Markdown as primary
        opts = options or DEFAULT_EXTRACT_OPTIONS
        anydoc = import_anydoc()
        data = source.path.read_bytes()
        fmt = self._detect_format(anydoc, source, data)

        try:
            markdown = (
                anydoc.to_markdown_bytes(data, fmt) if fmt else anydoc.to_markdown_bytes(data)
            )
        except anydoc.EncryptedError as exc:
            raise RuntimeError(f"Document is encrypted or password-protected: {exc}") from exc
        except anydoc.ConvertError as exc:
            raise RuntimeError(f"AnyDoc could not convert file: {exc}") from exc

        document = None
        # PDF has no document model in AnyDoc — Markdown only.
        if fmt != "pdf":
            try:
                document = anydoc.to_document(data, fmt) if fmt else anydoc.to_document(data)
            except anydoc.ConvertError:
                document = None

        markdown_str = str(markdown or "")
        if document is not None:
            tree_md = document_to_markdown(document)
            if tree_md.strip():
                markdown_str = tree_md
            markdown_str = _embed_assets_as_data_urls(markdown_str, document)

        if _markdown_looks_empty(markdown_str):
            raise RuntimeError("AnyDoc produced empty Markdown (likely scanned/image-only PDF)")

        asset_count = len(getattr(document, "assets", None) or []) if document else 0
        block_count = len(getattr(document, "blocks", None) or []) if document else 0
        metadata = {
            "format": fmt,
            "block_count": block_count,
            "asset_count": asset_count,
        }
        page_json = {"source": self.id, **metadata, "text": markdown_str}
        return ReadResult(
            engine_id=self.id,
            engine_label=self.label,
            outputs=[
                DocumentOutput(kind=OutputKind.MARKDOWN, content=markdown_str),
                DocumentOutput(kind=OutputKind.JSON, data=page_json),
            ],
            pages=[{"page": 1, "markdown": markdown_str, "json": page_json}],
            page_count=1,
            metadata=metadata,
            options=opts.to_dict(),
        )

    @staticmethod
    def _detect_format(anydoc: Any, source: SourceFile, data: bytes) -> str | None:
        fmt = anydoc.format_from_bytes(data)
        if fmt:
            return fmt
        ext_fmt = anydoc.format_from_extension(source.suffix)
        if ext_fmt:
            return ext_fmt
        if source.suffix == ".csv":
            return "csv"
        return None
