"""Pre-read stage: cap OCR input resolution before readers run."""

from __future__ import annotations

from app.processing.models import SourceFile
from app.services.ocr_prepare import prepare_ocr_input
from app.services.options import ExtractOptions


class PrepareOcrInputStage:
    id = "prepare_ocr_input"

    def prepare(self, source: SourceFile, options: ExtractOptions) -> SourceFile:
        return prepare_ocr_input(source, options)
