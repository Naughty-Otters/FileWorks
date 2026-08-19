import { create } from "zustand";
import {
  createEmptyDocument,
  createNode,
  nextId,
  type DesignDocument,
  type DesignNode,
  type ElementKind,
  type NodeStyle,
  type TemplateVariable,
  type VariableType,
} from "./types";

export function findNode(node: DesignNode, id: string): DesignNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(node: DesignNode, id: string): DesignNode | null {
  if (node.children.some((child) => child.id === id)) return node;
  for (const child of node.children) {
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

type EditorStore = {
  doc: DesignDocument;
  selectedId: string | null;
  preview: boolean;
  load: (doc: DesignDocument) => void;
  select: (id: string | null) => void;
  setPreview: (value: boolean) => void;
  addNode: (kind: ElementKind) => void;
  updateNode: (id: string, patch: Partial<DesignNode>) => void;
  updateStyle: (id: string, patch: Partial<NodeStyle>) => void;
  removeNode: (id: string) => void;
  addVariable: (type?: VariableType) => void;
  updateVariable: (id: string, patch: Partial<TemplateVariable>) => void;
  removeVariable: (id: string) => void;
};

export const useEditorStore = create<EditorStore>((set) => ({
  doc: createEmptyDocument(),
  selectedId: null,
  preview: false,
  load: (doc) => set({ doc: structuredClone(doc), selectedId: null }),
  select: (selectedId) => set({ selectedId }),
  setPreview: (preview) => set({ preview }),
  addNode: (kind) =>
    set((state) => {
      const doc = structuredClone(state.doc);
      const parent = findNode(doc.root, state.selectedId || "root");
      const container = parent?.kind === "box" ? parent : findParent(doc.root, state.selectedId || "") || doc.root;
      const node = createNode(kind);
      const nextY = container.children.reduce((bottom, child) => Math.max(bottom, child.y + child.h + 12), 24);
      node.y = nextY;
      if (container.layout) {
        node.x = container.layout.padding;
        node.w = Math.max(20, container.w - container.layout.padding * 2);
      }
      container.children.push(node);
      return { doc, selectedId: node.id };
    }),
  updateNode: (id, patch) =>
    set((state) => {
      const doc = structuredClone(state.doc);
      const node = findNode(doc.root, id);
      if (node) Object.assign(node, patch);
      return { doc };
    }),
  updateStyle: (id, patch) =>
    set((state) => {
      const doc = structuredClone(state.doc);
      const node = findNode(doc.root, id);
      if (node) node.style = { ...node.style, ...patch };
      return { doc };
    }),
  removeNode: (id) =>
    set((state) => {
      const doc = structuredClone(state.doc);
      const parent = findParent(doc.root, id);
      if (parent) parent.children = parent.children.filter((node) => node.id !== id);
      return { doc, selectedId: null };
    }),
  addVariable: (type = "text") =>
    set((state) => {
      const doc = structuredClone(state.doc);
      const name = `variable_${doc.variables.length + 1}`;
      doc.variables.push({ id: nextId("var"), name, label: "New variable", type, sampleValue: type === "list" ? "[]" : type === "object" ? "{}" : "" });
      return { doc };
    }),
  updateVariable: (id, patch) =>
    set((state) => {
      const doc = structuredClone(state.doc);
      doc.variables = doc.variables.map((variable) => variable.id === id ? { ...variable, ...patch } : variable);
      return { doc };
    }),
  removeVariable: (id) =>
    set((state) => {
      const doc = structuredClone(state.doc);
      doc.variables = doc.variables.filter((variable) => variable.id !== id);
      return { doc };
    }),
}));
