"""Document processing domain — readers, decision, and format export.

Architecture
------------
SourceFile
    │
    ▼
Reader.can_process()          ← each reader declares capability
    │
    ▼
EngineDecisionMaker           ← picks ordered candidates (priority + fallback)
    │
    ▼
Reader.read()                 ← Text → Docling (prefer_structure) → AnyDoc → LLM (optional) → OCR
    │
    ▼
ReadResult / DocumentOutput   ← default output kind = Markdown
    │
    ▼
FormatExporter.export()       ← Markdown | Text | HTML | JSON | (future…)

Paddle providers under ``app.engines`` power ``OCRReader``.
``LLMReader`` uses ``app.engines.llm`` when ``LLM_PROVIDER`` and an API key are set.
"""

from app.processing.models import (
    Capability,
    DocumentOutput,
    ExportArtifact,
    OutputKind,
    ReadResult,
    SourceFile,
)
from app.processing.pipeline import DocumentPipeline, get_document_pipeline

__all__ = [
    "Capability",
    "DocumentOutput",
    "DocumentPipeline",
    "ExportArtifact",
    "OutputKind",
    "ReadResult",
    "SourceFile",
    "get_document_pipeline",
]
