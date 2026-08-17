"""Pipeline stage contracts — typed handoffs, no cross-stage reader calls."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from app.processing.models import ReadResult, SourceFile
from app.processing.structure.schema import StructureDocument
from app.services.options import ExtractOptions


@dataclass
class PipelineContext:
    """Shared state across stages. Ownership rules are documented on fields."""

    source: SourceFile
    options: ExtractOptions
    raw: ReadResult | None = None
    structure: StructureDocument | None = None
    markdown: str = ""
    regions: list[dict[str, Any]] = field(default_factory=list)
    image_size: dict[str, float] | None = None
    include_engine_json: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_api_dict(
        self,
        *,
        include_markdown: bool = True,
        include_json: bool = True,
    ) -> dict[str, Any]:
        raw = self.raw
        if raw is None:
            raise RuntimeError("PipelineContext missing ReadResult")

        pages = list(raw.pages or [])
        structure_payload = self.structure.model_dump(mode="json") if self.structure else None

        # Slim pages: drop fat engine json when structure is present unless opted in.
        if structure_payload is not None and not self.include_engine_json:
            slim_pages: list[dict[str, Any]] = []
            for page in pages:
                if not isinstance(page, dict):
                    continue
                slim = {k: v for k, v in page.items() if k != "json"}
                slim_pages.append(slim)
            pages = slim_pages

        payload: dict[str, Any] = {
            "engine": raw.engine_label,
            "provider": raw.engine_id,
            "page_count": raw.page_count,
            "pages": pages,
            "regions": self.regions or raw.regions,
            "image_size": self.image_size or raw.image_size,
            "options": raw.options,
            "metadata": {**raw.metadata, **self.metadata},
        }
        if include_markdown:
            payload["markdown"] = self.markdown or raw.markdown()
        if structure_payload is not None:
            payload["structure"] = structure_payload
        if include_json:
            if structure_payload is not None and not self.include_engine_json:
                # Prefer structure as the structured JSON surface.
                payload["json"] = structure_payload
            else:
                from app.processing.models import OutputKind

                json_out = raw.output(OutputKind.JSON)
                if json_out and json_out.data is not None:
                    payload["json"] = json_out.data
                else:
                    payload["json"] = {
                        "source": raw.engine_id,
                        "metadata": raw.metadata,
                        "pages": raw.pages,
                    }
        return payload


class Stage(Protocol):
    id: str

    def run(self, ctx: PipelineContext) -> None: ...
