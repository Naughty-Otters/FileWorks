"""FileWorks-owned document structure IR (post-recognition)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class StructureTextStyle(BaseModel):
    bold: bool = False
    italic: bool = False
    underline: bool = False
    strike: bool = False
    superscript: bool = False
    subscript: bool = False
    font_size_pt: float | None = None
    font_family: str | None = None
    color: str | None = None
    background_color: str | None = None


class StructureTextRun(BaseModel):
    text: str
    style: StructureTextStyle = Field(default_factory=StructureTextStyle)
    href: str | None = None


class StructureTableCell(BaseModel):
    r: int
    c: int
    text: str = ""
    rs: int = 1
    cs: int = 1
    html: str | None = None
    is_header: bool = False
    align: str | None = None
    style: str | None = None
    runs: list[StructureTextRun] = Field(default_factory=list)


class StructureTable(BaseModel):
    rows: int = 0
    cols: int = 0
    cells: list[StructureTableCell] = Field(default_factory=list)
    html: str | None = None


class StructureBlock(BaseModel):
    id: str
    page: int = 1
    label: str = "text"
    text: str = ""
    rich_text: str | None = None
    runs: list[StructureTextRun] = Field(default_factory=list)
    alignment: str | None = None
    order: int | float | None = None
    bbox: list[float] | None = None
    polygon: list[list[float]] | None = None
    group_id: str | None = None
    title_level: int | None = None
    score: float | None = None
    table: StructureTable | None = None
    formula: str | None = None
    image_ref: str | None = None


class StructureDocument(BaseModel):
    version: str = "1"
    engine: str = ""
    page_count: int = 1
    blocks: list[StructureBlock] = Field(default_factory=list)
    meta: dict[str, Any] = Field(default_factory=dict)

    def to_regions(self) -> list[dict[str, Any]]:
        regions: list[dict[str, Any]] = []
        for block in self.blocks:
            if not block.bbox or len(block.bbox) < 4:
                continue
            regions.append(
                {
                    "id": block.id,
                    "page": block.page,
                    "label": block.label,
                    "text": block.text,
                    "bbox": list(block.bbox),
                    "order": block.order,
                    "score": block.score,
                }
            )
        return regions
