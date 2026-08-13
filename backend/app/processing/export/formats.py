"""Built-in format exporters."""

from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path

from app.processing.export.base import FormatExporter
from app.processing.models import ExportArtifact, OutputKind, ReadResult


def _ensure_vendor_path() -> None:
    vendor = Path(__file__).resolve().parents[3] / "vendor"
    if vendor.is_dir() and str(vendor) not in sys.path:
        sys.path.insert(0, str(vendor))


def strip_markdown(markdown: str) -> str:
    text = markdown
    text = re.sub(r"```[\s\S]*?```", lambda m: m.group(0).strip("`"), text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"[*_~>]+", "", text)
    return text.strip()


def markdown_to_html(markdown: str, *, title: str = "Document") -> str:
    _ensure_vendor_path()
    try:
        import markdown as md_lib

        body = md_lib.markdown(
            markdown,
            extensions=["tables", "fenced_code", "nl2br", "sane_lists"],
        )
    except Exception:  # noqa: BLE001
        body = "<pre>" + html.escape(markdown) + "</pre>"

    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n'
        "<head>\n"
        '  <meta charset="utf-8" />\n'
        f"  <title>{html.escape(title)}</title>\n"
        "  <style>\n"
        "    body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.55; "
        "max-width: 48rem; margin: 2rem auto; padding: 0 1.25rem; color: #1a1a1a; }\n"
        "    img { max-width: 100%; height: auto; }\n"
        "    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }\n"
        "    th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; }\n"
        "    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }\n"
        "    pre { background: #f6f6f4; padding: 0.85rem 1rem; overflow: auto; }\n"
        "  </style>\n"
        "</head>\n"
        f"<body>\n{body}\n</body>\n"
        "</html>\n"
    )


class MarkdownExporter(FormatExporter):
    id = "markdown"
    label = "Markdown"
    aliases = ("md",)

    def can_export(self, source_kind: OutputKind = OutputKind.MARKDOWN) -> bool:
        return source_kind in {OutputKind.MARKDOWN, OutputKind.TEXT}

    def export(
        self,
        *,
        markdown: str,
        title: str = "document",
        read_result: ReadResult | None = None,
    ) -> ExportArtifact:
        del title, read_result
        return ExportArtifact(
            data=(markdown or "").encode("utf-8"),
            media_type="text/markdown; charset=utf-8",
            extension="md",
            format_id=self.id,
        )


class TextExporter(FormatExporter):
    id = "txt"
    label = "Plain text"
    aliases = ("text",)

    def can_export(self, source_kind: OutputKind = OutputKind.MARKDOWN) -> bool:
        return source_kind in {OutputKind.MARKDOWN, OutputKind.TEXT}

    def export(
        self,
        *,
        markdown: str,
        title: str = "document",
        read_result: ReadResult | None = None,
    ) -> ExportArtifact:
        del title, read_result
        return ExportArtifact(
            data=strip_markdown(markdown or "").encode("utf-8"),
            media_type="text/plain; charset=utf-8",
            extension="txt",
            format_id=self.id,
        )


class HtmlExporter(FormatExporter):
    id = "html"
    label = "HTML"
    aliases = ()

    def can_export(self, source_kind: OutputKind = OutputKind.MARKDOWN) -> bool:
        return source_kind == OutputKind.MARKDOWN

    def export(
        self,
        *,
        markdown: str,
        title: str = "document",
        read_result: ReadResult | None = None,
    ) -> ExportArtifact:
        del read_result
        html_doc = markdown_to_html(markdown or "", title=title)
        return ExportArtifact(
            data=html_doc.encode("utf-8"),
            media_type="text/html; charset=utf-8",
            extension="html",
            format_id=self.id,
        )


class JsonExporter(FormatExporter):
    id = "json"
    label = "JSON"
    aliases = ()

    def can_export(self, source_kind: OutputKind = OutputKind.MARKDOWN) -> bool:
        return True

    def export(
        self,
        *,
        markdown: str,
        title: str = "document",
        read_result: ReadResult | None = None,
    ) -> ExportArtifact:
        payload = {
            "title": title,
            "markdown": markdown or "",
            "text": strip_markdown(markdown or ""),
        }
        if read_result is not None:
            payload["engine"] = read_result.engine_label
            payload["metadata"] = read_result.metadata
        return ExportArtifact(
            data=json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"),
            media_type="application/json; charset=utf-8",
            extension="json",
            format_id=self.id,
        )
