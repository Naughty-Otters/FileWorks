export type ElementKind = "box" | "heading" | "paragraph" | "image";

export type Direction = "row" | "column";
export type Align = "start" | "center" | "end" | "stretch";
export type Justify = "start" | "center" | "end" | "space-between";
export type TextAlign = "left" | "center" | "right";
export type BorderStyle = "none" | "solid" | "dashed";
export type ObjectFit = "cover" | "contain";

export interface LayoutProps {
  direction: Direction;
  gap: number;
  padding: number;
  align: Align;
  justify: Justify;
}

/** Visual/typography styling for a node. Boxes only read the
 * background/border fields; heading/paragraph read all of them. */
export interface NodeStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  /** Non-empty makes the text a hyperlink in the exported/printed document. */
  link: string;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  borderStyle: BorderStyle;
}

/** A node in the design document tree. Only `box` may hold children / an
 * auto-layout config; `heading`, `paragraph` and `image` are leaves. */
export interface DesignNode {
  id: string;
  kind: ElementKind;
  label: string;
  /** Heading level 1-6 (H1..H6). Unused for other kinds. */
  level?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  style: NodeStyle;
  /** Present when this box stacks its children automatically (the
   * default). Null means freeform: children keep whatever position they
   * were dragged to. */
  layout: LayoutProps | null;
  children: DesignNode[];
  /** image kind only: a data URL for the attached picture, or empty
   * before one has been chosen (renders an upload placeholder). */
  imageSrc?: string;
  /** image kind only: how the picture fills its box. */
  objectFit?: ObjectFit;
  /** box kind only: expand once per item in a list variable. */
  repeat?: RepeatDefinition;
}

export type RepeatDefinition = { over: string; as: string };

export interface PageSize {
  w: number;
  h: number;
}

export type VariableType = "text" | "number" | "currency" | "date" | "image" | "list" | "object";

export type VariableSchemaField = {
  id: string;
  name: string;
  label: string;
  type: Exclude<VariableType, "list" | "object"> | "object";
};

/**
 * A named placeholder a text or image field can reference as `{{ name }}`
 * (heading/paragraph/box caption content, or an image's `imageSrc`). The
 * document itself never resolves these — `label`/`imageSrc` strings stay
 * literal Jinja-style template text. `sampleValue` is the variable's
 * **default value**: used in editor preview / output when no runtime value
 * is supplied. Kept as `sampleValue` in JSON for API compatibility.
 */
export interface TemplateVariable {
  id: string;
  /** Jinja identifier: letters/digits/underscore, dots for attribute
   * access (e.g. "employee.name"). Must be unique within the document. */
  name: string;
  /** Human-friendly label shown in pickers, e.g. "Employee name". */
  label: string;
  type: VariableType;
  sampleValue: string;
  itemSchema?: VariableSchemaField[];
}

export interface DesignDocument {
  version: 2;
  /** The fixed size of one page. The document can span multiple pages —
   * root.h is always a whole multiple of pageSize.h, and root.w always
   * equals pageSize.w. */
  pageSize: PageSize;
  root: DesignNode;
  /** The set of `{{ name }}` placeholders this template declares. Purely
   * a registry + sample-value store for this editor's Preview mode and
   * "insert variable" pickers — see TemplateVariable. */
  variables: TemplateVariable[];
}

/** Matches a `{{ name }}` token, capturing the identifier (letters,
 * digits, underscore, dots for attribute access). Shared by the
 * highlighting parser, the sample-value resolver, and used-variable
 * detection so all three agree on exactly what counts as a token. */
export const VARIABLE_TOKEN_RE = /\{\{\s*([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\s*\}\}/g;

/** True if a variable name is a syntactically valid Jinja-style
 * identifier/attribute path. */
export function isValidVariableName(name: string): boolean {
  return /^[a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*$/.test(name);
}

export const VARIABLE_TYPE_OPTIONS: { value: VariableType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "currency", label: "Currency" },
  { value: "date", label: "Date" },
  { value: "image", label: "Image" },
  { value: "list", label: "List" },
  { value: "object", label: "Object" },
];

/** Flat list kept for callers that map option values directly. */
export const VARIABLE_TYPES: VariableType[] = VARIABLE_TYPE_OPTIONS.map((o) => o.value);

export const CONTAINER_KINDS: ReadonlySet<ElementKind> = new Set(["box"]);

export function isContainer(kind: ElementKind): boolean {
  return CONTAINER_KINDS.has(kind);
}

export function isTextKind(kind: ElementKind): boolean {
  return kind === "heading" || kind === "paragraph";
}

/** drag-and-drop MIME type used when dragging a shape tile from the
 * Palette onto the Canvas. */
export const DND_MIME = "application/x-designpad-kind";

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

/** Default for a freshly added Box: children stack top-to-bottom
 * automatically, so a non-technical user never has to think about x/y
 * coordinates. Freeform placement is an opt-in "Advanced" toggle. */
export const DEFAULT_LAYOUT: LayoutProps = {
  direction: "column",
  gap: 12,
  padding: 16,
  align: "stretch",
  justify: "start",
};

const BASE_STYLE: NodeStyle = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 14,
  color: "#1e293b",
  bold: false,
  italic: false,
  underline: false,
  align: "left",
  link: "",
  backgroundColor: "transparent",
  borderColor: "transparent",
  borderWidth: 0,
  borderStyle: "none",
};

/** Font size + weight preset applied when a heading's level is set. */
export const HEADING_LEVEL_PRESET: Record<number, { fontSize: number }> = {
  1: { fontSize: 28 },
  2: { fontSize: 23 },
  3: { fontSize: 19 },
  4: { fontSize: 16 },
  5: { fontSize: 14 },
  6: { fontSize: 13 },
};

/** Page size presets (px at ~96dpi) offered when starting a blank
 * document. Receipt is intentionally narrow/tall, like a till printout. */
export const PAGE_SIZE_PRESETS: { id: string; label: string; size: PageSize }[] = [
  { id: "letter", label: "Letter", size: { w: 850, h: 1100 } },
  { id: "a4", label: "A4", size: { w: 794, h: 1123 } },
  { id: "legal", label: "Legal", size: { w: 850, h: 1400 } },
  { id: "receipt", label: "Receipt", size: { w: 320, h: 600 } },
];

interface KindDefaults {
  label: string;
  w: number;
  h: number;
  container: boolean;
  style: NodeStyle;
  level?: number;
}

export const KIND_DEFAULTS: Record<ElementKind, KindDefaults> = {
  box: {
    label: "Box",
    w: 400,
    h: 160,
    container: true,
    style: {
      ...BASE_STYLE,
      backgroundColor: "#ffffff",
      borderStyle: "solid",
      borderWidth: 1,
      borderColor: "#e2e8f0",
    },
  },
  heading: {
    label: "Heading",
    w: 320,
    h: 42,
    container: false,
    level: 1,
    style: { ...BASE_STYLE, fontSize: 28, bold: true, color: "#0f172a" },
  },
  paragraph: {
    label:
      "Paragraph text. Double-click to edit — write the body copy for this block here.",
    w: 340,
    h: 100,
    container: false,
    style: { ...BASE_STYLE, fontSize: 14, color: "#334155" },
  },
  image: {
    label: "Image",
    w: 300,
    h: 200,
    container: false,
    style: {
      ...BASE_STYLE,
      backgroundColor: "#f1f5f9",
      borderStyle: "dashed",
      borderWidth: 1,
      borderColor: "#cbd5e1",
    },
  },
};

/** Where a new freeform child should land by default: stacked below the
 * lowest existing sibling (like pressing Enter at the end of a document),
 * rather than a diagonal stagger that mostly overlaps same-sized blocks. */
export function nextStackedPosition(parent: DesignNode): { x: number; y: number } {
  const PAD = 16;
  if (parent.children.length === 0) return { x: PAD, y: PAD };
  const maxBottom = Math.max(...parent.children.map((c) => c.y + c.h));
  return { x: PAD, y: maxBottom + 12 };
}

export function createNode(kind: ElementKind, x = 0, y = 0): DesignNode {
  const defaults = KIND_DEFAULTS[kind];
  return {
    id: nextId(kind),
    kind,
    label: defaults.label,
    level: defaults.level,
    x,
    y,
    w: defaults.w,
    h: defaults.h,
    style: { ...defaults.style },
    // Boxes stack their contents automatically by default — no coordinate
    // math for the user. Freeform placement is an opt-in Advanced toggle.
    layout: defaults.container ? { ...DEFAULT_LAYOUT } : null,
    children: [],
    ...(kind === "image" ? { imageSrc: "", objectFit: "cover" as ObjectFit } : {}),
  };
}

/** A page-like default canvas size (Letter, ~96dpi) so the editor reads as
 * a printable document rather than an arbitrary whiteboard. The page
 * itself is always freeform: top-level boxes can be dragged anywhere. */
export function createEmptyDocument(pageSize: PageSize = PAGE_SIZE_PRESETS[0].size): DesignDocument {
  return {
    version: 2,
    pageSize: { ...pageSize },
    root: {
      id: "root",
      kind: "box",
      label: "Document",
      x: 0,
      y: 0,
      w: pageSize.w,
      h: pageSize.h,
      style: { ...BASE_STYLE, backgroundColor: "#ffffff" },
      layout: null,
      children: [],
    },
    variables: [],
  };
}

export function createVariable(
  name: string,
  label: string,
  type: VariableType = "text",
  sampleValue: string = "",
): TemplateVariable {
  const fallback =
    type === "list" ? "[]" : type === "object" ? "{}" : type === "number" ? "0" : type === "currency" ? "$0.00" : "";
  return {
    id: nextId("var"),
    name,
    label,
    type,
    sampleValue: sampleValue.trim() ? sampleValue : fallback,
    ...(type === "list" ? { itemSchema: [] as VariableSchemaField[] } : {}),
  };
}

export function normalizeDocument(value: unknown): DesignDocument {
  if (!value || typeof value !== "object") throw new Error("Template JSON must be an object");
  const candidate = structuredClone(value) as Partial<DesignDocument>;
  if (!candidate.root || !Array.isArray(candidate.root.children)) {
    throw new Error("Template JSON is missing a document root");
  }
  return {
    ...(candidate as DesignDocument),
    version: 2,
    pageSize: candidate.pageSize || { w: 850, h: 1100 },
    variables: Array.isArray(candidate.variables) ? candidate.variables : [],
  };
}
