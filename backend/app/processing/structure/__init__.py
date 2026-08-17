"""Structure package public API."""

from app.processing.structure.adapters import normalize_read_result
from app.processing.structure.fill import fill_structure
from app.processing.structure.project import project_markdown, project_regions
from app.processing.structure.richness import structure_is_richer
from app.processing.structure.schema import (
    StructureBlock,
    StructureDocument,
    StructureTable,
    StructureTableCell,
    StructureTextRun,
    StructureTextStyle,
)

__all__ = [
    "StructureBlock",
    "StructureDocument",
    "StructureTable",
    "StructureTableCell",
    "StructureTextRun",
    "StructureTextStyle",
    "fill_structure",
    "normalize_read_result",
    "project_markdown",
    "project_regions",
    "structure_is_richer",
]
