from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

VariableType = Literal[
    "text", "string", "number", "boolean", "currency", "date", "image", "object", "list"
]


class VariableSchemaField(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str = ""
    name: str
    label: str = ""
    type: VariableType = "text"
    required: bool = False


class VariableSchema(BaseModel):
    """Editor variable declaration, including list/object item fields."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str = ""
    name: str
    label: str = ""
    type: VariableType = "text"
    sample_value: str = Field(default="", alias="sampleValue")
    required: bool = False
    item_schema: list[VariableSchemaField] = Field(default_factory=list, alias="itemSchema")


class NodeStyle(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    font_family: str | None = Field(default=None, alias="fontFamily")
    font_size: float | None = Field(default=None, alias="fontSize", ge=1)
    bold: bool = False
    italic: bool = False
    underline: bool = False
    color: str | None = None
    align: Literal["left", "center", "right"] = "left"
    link: str = ""
    background_color: str = Field(default="transparent", alias="backgroundColor")
    border_color: str = Field(default="transparent", alias="borderColor")
    border_width: float = Field(default=0, alias="borderWidth", ge=0)
    border_style: Literal["none", "solid", "dashed"] = Field(default="none", alias="borderStyle")


class NodeLayout(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    direction: Literal["row", "column"] = "column"
    gap: float = Field(default=0, ge=0)
    padding: float = Field(default=0, ge=0)
    align: Literal["start", "center", "end", "stretch"] = "stretch"
    justify: Literal["start", "center", "end", "space-between"] = "start"


class RepeatSpec(BaseModel):
    over: str = Field(min_length=1)
    as_: str = Field(default="item", alias="as", min_length=1)


class DesignNode(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    type: Literal["box", "heading", "paragraph", "image"] = Field(alias="kind")
    label: str = ""
    image_src: str | None = Field(default=None, alias="imageSrc")
    object_fit: Literal["cover", "contain"] = Field(default="cover", alias="objectFit")
    level: int = Field(default=1, ge=1, le=6)
    x: float = 0
    y: float = 0
    w: float = Field(default=100, gt=0)
    h: float = Field(default=40, gt=0)
    style: NodeStyle = Field(default_factory=NodeStyle)
    layout: NodeLayout | None = None
    children: list[DesignNode] = Field(default_factory=list)
    repeat: RepeatSpec | None = None

    @model_validator(mode="before")
    @classmethod
    def normalize_node(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        data.setdefault("kind", data.get("type"))
        old_layout = data.get("layout")
        if isinstance(old_layout, dict) and any(key in old_layout for key in ("x", "y", "width")):
            data.setdefault("x", old_layout.get("x", 0))
            data.setdefault("y", old_layout.get("y", 0))
            data.setdefault("w", old_layout.get("width", 100))
            data.setdefault("h", old_layout.get("height", 40))
            data["layout"] = None
        return data

    @model_validator(mode="after")
    def validate_node(self) -> DesignNode:
        if self.type != "box" and self.children:
            raise ValueError("only box nodes may contain children")
        if self.type != "box" and self.repeat is not None:
            raise ValueError("repeat is only supported on box nodes")
        return self


class PageStyle(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    w: float = Field(default=850, gt=0)
    h: float = Field(default=1100, gt=0)


class DesignDocument(BaseModel):
    """Version 2 persisted template document.

    Version 1 payloads are accepted and normalized to the v2 shape at the API
    boundary. Unknown style keys are retained for forward-compatible editors.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    version: Literal[2] = 2
    page: PageStyle = Field(default_factory=PageStyle, alias="pageSize")
    root: DesignNode
    variables: list[VariableSchema] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def normalize_v1(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        data = dict(value)
        version = data.get("version", 1)
        if version not in (1, 2, "1", "2"):
            raise ValueError(f"unsupported design document version: {version}")
        nodes = data.pop("elements", data.pop("nodes", []))
        if "root" not in data:
            data["root"] = {
                "id": "root",
                "kind": "box",
                "label": "Document",
                "x": 0,
                "y": 0,
                "w": 850,
                "h": 1100,
                "children": nodes,
            }
        if "pageSize" not in data:
            page = dict(data.pop("page", {}) or {})
            data["pageSize"] = {
                "w": data.pop("pageWidth", page.get("width", page.get("w", 850))),
                "h": data.pop("pageHeight", page.get("height", page.get("h", 1100))),
            }
        raw_variables = data.get("variables") or []
        if isinstance(raw_variables, dict):
            normalized: list[dict[str, Any]] = []
            for name, definition in raw_variables.items():
                item = dict(definition) if isinstance(definition, dict) else {}
                item["name"] = name
                item.setdefault("id", name)
                item["type"] = {
                    "string": "text",
                }.get(item.get("type"), item.get("type", "text"))
                if isinstance(item.get("properties"), dict):
                    item["itemSchema"] = [
                        {"id": key, "name": key, **(child if isinstance(child, dict) else {})}
                        for key, child in item.pop("properties").items()
                    ]
                normalized.append(item)
            data["variables"] = normalized
        elif isinstance(raw_variables, list):
            data["variables"] = [
                {
                    **(item if isinstance(item, dict) else {}),
                    "id": (item.get("id") or item.get("name") if isinstance(item, dict) else item),
                    "name": (item.get("name") if isinstance(item, dict) else item),
                    "type": {
                        "string": "text",
                    }.get(item.get("type"), item.get("type", "text"))
                    if isinstance(item, dict)
                    else "text",
                }
                for item in raw_variables
            ]
        data["version"] = 2
        return data

    def iter_nodes(self):
        def walk(node: DesignNode):
            yield node
            for child in node.children:
                yield from walk(child)

        return walk(self.root)

    def variable_map(self) -> dict[str, VariableSchema]:
        return {variable.name: variable for variable in self.variables}
