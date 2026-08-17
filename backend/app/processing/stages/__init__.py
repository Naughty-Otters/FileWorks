"""Processing stages package."""

from app.processing.stages.base import PipelineContext, Stage
from app.processing.stages.ocr_prepare import PrepareOcrInputStage
from app.processing.stages.structure_stages import FillStage, NormalizeStage, ProjectStage

__all__ = [
    "FillStage",
    "NormalizeStage",
    "PipelineContext",
    "PrepareOcrInputStage",
    "ProjectStage",
    "Stage",
]
