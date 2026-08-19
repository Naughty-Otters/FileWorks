export type ElementKind = "box" | "heading" | "paragraph" | "image";
export type VariableType = "text" | "number" | "currency" | "date" | "image" | "list" | "object";

export type LayoutProps = {
  direction: "row" | "column";
  gap: number;
  padding: number;
  align: "start" | "center" | "end" | "stretch";
  justify: "start" | "center" | "end" | "space-between";
};

export type NodeStyle = {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: "left" | "center" | "right";
  link: string;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  borderStyle: "none" | "solid" | "dashed";
};

export type RepeatDefinition = { over: string; as: string };

export type DesignNode = {
  id: string;
  kind: ElementKind;
  label: string;
  level?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  style: NodeStyle;
  layout: LayoutProps | null;
  children: DesignNode[];
  imageSrc?: string;
  objectFit?: "cover" | "contain";
  repeat?: RepeatDefinition;
};

export type VariableSchemaField = {
  id: string;
  name: string;
  label: string;
  type: Exclude<VariableType, "list" | "object"> | "object";
};

export type TemplateVariable = {
  id: string;
  name: string;
  label: string;
  type: VariableType;
  sampleValue: string;
  itemSchema?: VariableSchemaField[];
};

export type DesignDocument = {
  version: 2;
  pageSize: { w: number; h: number };
  root: DesignNode;
  variables: TemplateVariable[];
};

export const VARIABLE_TOKEN_RE = /\{\{\s*([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\s*\}\}/g;
export const VARIABLE_TYPES: VariableType[] = ["text", "number", "currency", "date", "image", "list", "object"];

const baseStyle: NodeStyle = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 14,
  color: "#1c2420",
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

let sequence = 0;
export function nextId(prefix: string) {
  sequence += 1;
  return `${prefix}_${Date.now().toString(36)}_${sequence}`;
}

export function createNode(kind: ElementKind): DesignNode {
  const text = kind === "heading" ? "Heading" : kind === "paragraph" ? "Paragraph text" : kind === "image" ? "Image" : "Box";
  return {
    id: nextId(kind),
    kind,
    label: text,
    level: kind === "heading" ? 1 : undefined,
    x: 24,
    y: 24,
    w: kind === "box" ? 420 : 320,
    h: kind === "heading" ? 50 : kind === "paragraph" ? 90 : 180,
    style: {
      ...baseStyle,
      fontSize: kind === "heading" ? 28 : 14,
      bold: kind === "heading",
      backgroundColor: kind === "box" ? "#ffffff" : kind === "image" ? "#f1f5f9" : "transparent",
      borderColor: kind === "box" || kind === "image" ? "#d7ded9" : "transparent",
      borderWidth: kind === "box" || kind === "image" ? 1 : 0,
      borderStyle: kind === "image" ? "dashed" : kind === "box" ? "solid" : "none",
    },
    layout: kind === "box" ? { direction: "column", gap: 12, padding: 16, align: "stretch", justify: "start" } : null,
    children: [],
    ...(kind === "image" ? { imageSrc: "", objectFit: "cover" as const } : {}),
  };
}

export function createEmptyDocument(): DesignDocument {
  const root = createNode("box");
  return {
    version: 2,
    pageSize: { w: 850, h: 1100 },
    root: { ...root, id: "root", label: "Document", x: 0, y: 0, w: 850, h: 1100, layout: null, children: [] },
    variables: [],
  };
}

export function normalizeDocument(value: unknown): DesignDocument {
  if (!value || typeof value !== "object") throw new Error("Template JSON must be an object");
  const candidate = structuredClone(value) as Partial<DesignDocument>;
  if (!candidate.root || !Array.isArray(candidate.root.children)) throw new Error("Template JSON is missing a document root");
  return {
    ...(candidate as DesignDocument),
    version: 2,
    pageSize: candidate.pageSize || { w: 850, h: 1100 },
    variables: Array.isArray(candidate.variables) ? candidate.variables : [],
  };
}
