"""Shared domain models for document processing."""

from __future__ import annotations

from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import Field
from pydantic.dataclasses import dataclass


class OutputKind(str, Enum):
    """Logical content kind produced by a reader."""

    MARKDOWN = "markdown"
    TEXT = "text"
    JSON = "json"


@dataclass(frozen=True)
class SourceFile:
    """Normalized description of an uploaded file for engine decisions."""

    path: Path
    filename: str
    suffix: str
    mime_type: str | None = None
    size_bytes: int = 0

    @classmethod
    def from_path(
        cls,
        path: Path,
        *,
        filename: str | None = None,
        mime_type: str | None = None,
    ) -> SourceFile:
        resolved = path.resolve()
        name = filename or resolved.name
        suffix = resolved.suffix.lower()
        size = resolved.stat().st_size if resolved.exists() else 0
        return cls(
            path=resolved,
            filename=name,
            suffix=suffix,
            mime_type=mime_type,
            size_bytes=size,
        )

    @property
    def is_image(self) -> bool:
        if self.suffix in {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp"}:
            return True
        if self.mime_type and self.mime_type.startswith("image/"):
            return True
        return False


@dataclass(frozen=True)
class Capability:
    """Result of ``Reader.can_process``."""

    supported: bool
    confidence: float = 1.0
    reason: str = ""

    @classmethod
    def yes(cls, reason: str = "", *, confidence: float = 1.0) -> Capability:
        return cls(supported=True, confidence=confidence, reason=reason)

    @classmethod
    def no(cls, reason: str) -> Capability:
        return cls(supported=False, confidence=0.0, reason=reason)


@dataclass
class DocumentOutput:
    """One typed representation of extracted content."""

    kind: OutputKind
    content: str = ""
    data: Any | None = None

    def as_text(self) -> str:
        if self.content:
            return self.content
        if self.data is not None:
            return str(self.data)
        return ""


@dataclass
class ReadResult:
    """Normalized result of a reader."""

    engine_id: str
    engine_label: str
    outputs: list[DocumentOutput] = Field(default_factory=list)
    pages: list[dict[str, Any]] = Field(default_factory=list)
    regions: list[dict[str, Any]] = Field(default_factory=list)
    image_size: dict[str, float] | None = None
    page_count: int = 1
    metadata: dict[str, Any] = Field(default_factory=dict)
    options: dict[str, Any] | None = None

    def output(self, kind: OutputKind) -> DocumentOutput | None:
        for item in self.outputs:
            if item.kind == kind:
                return item
        return None

    def markdown(self) -> str:
        found = self.output(OutputKind.MARKDOWN)
        if found:
            return found.content
        text = self.output(OutputKind.TEXT)
        return text.content if text else ""

    def with_markdown(
        self,
        markdown: str,
        *,
        pages: list[dict[str, Any]] | None = None,
        metadata_extra: dict[str, Any] | None = None,
    ) -> ReadResult:
        """Return a copy whose Markdown output (and matching page/json text) is replaced."""
        previous = self.markdown()
        outputs = [
            DocumentOutput(kind=OutputKind.MARKDOWN, content=markdown)
            if item.kind == OutputKind.MARKDOWN
            else item
            for item in self.outputs
        ]
        if not any(item.kind == OutputKind.MARKDOWN for item in outputs):
            outputs.append(DocumentOutput(kind=OutputKind.MARKDOWN, content=markdown))
        new_outputs: list[DocumentOutput] = []
        for item in outputs:
            if item.kind == OutputKind.JSON and isinstance(item.data, dict) and item.data.get("text") == previous:
                new_outputs.append(DocumentOutput(kind=item.kind, content=item.content, data={**item.data, "text": markdown}))
            else:
                new_outputs.append(item)
        next_pages = pages
        if next_pages is None:
            next_pages = []
            for page in self.pages:
                if isinstance(page, dict) and page.get("markdown") == previous:
                    next_pages.append({**page, "markdown": markdown})
                else:
                    next_pages.append(page)
        metadata = dict(self.metadata)
        if metadata_extra:
            metadata.update(metadata_extra)
        return ReadResult(
            engine_id=self.engine_id,
            engine_label=self.engine_label,
            outputs=new_outputs,
            pages=next_pages,
            regions=self.regions,
            image_size=self.image_size,
            page_count=self.page_count,
            metadata=metadata,
            options=self.options,
        )

    def to_api_dict(self, *, include_markdown: bool = True, include_json: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "engine": self.engine_label,
            "provider": self.engine_id,
            "page_count": self.page_count,
            "pages": self.pages,
            "regions": self.regions,
            "image_size": self.image_size,
            "options": self.options,
            "metadata": self.metadata,
        }
        if include_markdown:
            payload["markdown"] = self.markdown()
        if include_json:
            json_out = self.output(OutputKind.JSON)
            if json_out and json_out.data is not None:
                payload["json"] = json_out.data
            else:
                payload["json"] = {
                    "source": self.engine_id,
                    "metadata": self.metadata,
                    "pages": self.pages,
                }
        return payload


@dataclass(frozen=True)
class ExportArtifact:
    """Bytes ready for download."""

    data: bytes
    media_type: str
    extension: str
    format_id: str
