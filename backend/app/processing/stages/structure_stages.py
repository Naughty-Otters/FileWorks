"""Normalize → Fill → Project stages (post-Read only)."""

from __future__ import annotations

import logging

from app.processing.stages.base import PipelineContext
from app.processing.structure import (
    fill_structure,
    normalize_read_result,
    project_markdown,
    project_regions,
)
from app.services.markdown import markdown_looks_flat

logger = logging.getLogger(__name__)


def _has_rich_markup(markdown: str) -> bool:
    lower = (markdown or "").lower()
    return any(
        marker in lower
        for marker in (
            "<table",
            "<span",
            "<mark",
            "<strong",
            "<b>",
            "style=",
            "**",
            "data:image",
            "![",
        )
    )


class NormalizeStage:
    id = "normalize"

    def run(self, ctx: PipelineContext) -> None:
        if ctx.raw is None:
            return
        ctx.structure = normalize_read_result(ctx.raw)
        if ctx.structure is None:
            logger.info("NormalizeStage: no structure derived (engine=%s)", ctx.raw.engine_id)


class FillStage:
    id = "fill"

    def run(self, ctx: PipelineContext) -> None:
        if ctx.structure is None:
            return
        ctx.structure = fill_structure(ctx.structure)


class ProjectStage:
    id = "project"

    def run(self, ctx: PipelineContext) -> None:
        if ctx.raw is None:
            return
        engine_md = ctx.raw.markdown() or ""
        if ctx.structure is not None:
            projected = project_markdown(ctx.structure)
            # Prefer projected when prefer_structure and engine md is empty/flat,
            # or when projected is richer in tables/headings.
            if projected and (
                not engine_md.strip()
                or (
                    ctx.options.prefer_structure
                    and markdown_looks_flat(engine_md)
                    and not markdown_looks_flat(projected)
                    and not _has_rich_markup(engine_md)
                )
            ):
                ctx.markdown = projected
            else:
                ctx.markdown = engine_md or projected
            ctx.regions = project_regions(ctx.structure) or list(ctx.raw.regions or [])
        else:
            ctx.markdown = engine_md
            ctx.regions = list(ctx.raw.regions or [])
        ctx.image_size = ctx.raw.image_size
