import { create } from "zustand";
import {
  type DesignDocument,
  type DesignNode,
  type ElementKind,
  type LayoutProps,
  type NodeStyle,
  type TemplateVariable,
  type VariableType,
  DEFAULT_LAYOUT,
  HEADING_LEVEL_PRESET,
  createEmptyDocument,
  createNode,
  createVariable,
  isValidVariableName,
  nextStackedPosition,
  normalizeDocument,
} from "./types";
import { computeLayout } from "./compute-layout";
import { relayoutBranch, relayoutAfterResize } from "./layout/arrange";
import { enforcePageBounds } from "./layout/page-bounds";
import type { AlignmentGuide } from "./alignmentGuides";

function findNode(node: DesignNode, id: string): DesignNode | null {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function findParent(node: DesignNode, id: string): DesignNode | null {
  for (const child of node.children) {
    if (child.id === id) return node;
    const found = findParent(child, id);
    if (found) return found;
  }
  return null;
}

/** True if `targetId` is `node` itself or anywhere in its subtree. Used to
 * stop a container from being dropped into its own descendant. */
function isSelfOrDescendant(node: DesignNode, targetId: string): boolean {
  if (node.id === targetId) return true;
  return node.children.some((c) => isSelfOrDescendant(c, targetId));
}

interface HistoryState {
  past: DesignDocument[];
  future: DesignDocument[];
}

interface EditorState {
  doc: DesignDocument;
  selectedId: string | null;
  layoutPending: boolean;
  zoom: number;
  history: HistoryState;
  /** Whether the "start your document" template wizard is showing.
   * Starts true (empty doc, first run); the New-document toolbar button
   * reopens it later without touching the current document until the
   * user actually picks something in it. */
  showTemplatePicker: boolean;
  setShowTemplatePicker: (show: boolean) => void;
  /** Whether the variables manager modal is showing. Opened from the
   * toolbar or left panel — like showTemplatePicker, it lives here rather
   * than as local state owned by one component. */
  showVariablesPanel: boolean;
  setShowVariablesPanel: (show: boolean) => void;
  /** Design-time view toggle: shows `{{ name }}` tokens highlighted (off)
   * vs. substituted with each variable's sampleValue (on). Purely a
   * rendering mode — never touches the document, never undoable. */
  previewMode: boolean;
  setPreviewMode: (preview: boolean) => void;
  undo: () => void;
  redo: () => void;
  setZoom: (zoom: number) => void;
  select: (id: string | null) => void;
  addElement: (kind: ElementKind, parentId: string, x: number, y: number) => void;
  removeElement: (id: string) => void;
  updateLabel: (id: string, label: string) => void;
  updateStyle: (id: string, patch: Partial<NodeStyle>) => void;
  /** Generic field patch (repeat, level extras, etc.). */
  updateNode: (id: string, patch: Partial<DesignNode>) => void;
  updateLevel: (id: string, level: number) => void;
  /** Cheap position-only move for freeform nodes. Never touches WASM: a
   * freeform parent leaves children's x/y untouched during layout, so
   * there is nothing to recompute. */
  moveNode: (id: string, x: number, y: number) => void;
  /** Resizing can change how an auto-layout parent distributes its
   * children (stretch/justify), so this re-runs the WASM solver. */
  resizeNode: (id: string, w: number, h: number) => void;
  /** Full box commit used by multi-directional resize handles (n/w/nw/…)
   * that move the origin as well as the size. */
  updateBox: (id: string, box: { x: number; y: number; w: number; h: number }) => void;
  updateLayoutProps: (id: string, patch: Partial<LayoutProps>) => void;
  toggleAutoLayout: (id: string, enabled: boolean) => void;
  reorderChild: (id: string, direction: -1 | 1) => void;
  /** General-purpose move within the tree: pulls `id` out of its current
   * parent and splices it into `newParentId`'s children at `index`.
   * Backs both cross-container drag-and-drop (canvas + Layers panel) and
   * plain reordering. Refuses to move a node into itself or its own
   * descendant. `position`, when given, sets the node's x/y in its new
   * parent (used for canvas drops); otherwise existing coordinates are
   * kept, with a cascading default offset if the parent actually changed
   * and the new parent is freeform. */
  moveNodeInTree: (
    id: string,
    newParentId: string,
    index: number,
    position?: { x: number; y: number },
  ) => void;
  /** Transient highlight target while dragging over a potential drop
   * container. Not part of the document — never persisted/undone. */
  dropTargetId: string | null;
  setDropTarget: (id: string | null) => void;
  /** Transient reorder indicator (sibling to drop before/after, or a
   * container to drop into) while dragging an existing block. */
  dragAnchor: { parentId: string; anchorId: string | null; zone: "before" | "after" | "into" } | null;
  setDragAnchor: (
    anchor: { parentId: string; anchorId: string | null; zone: "before" | "after" | "into" } | null,
  ) => void;
  /** Live pixel position of whatever block is being freeform-dragged,
   * keyed by id so any ElementView instance (not just the one that
   * received the pointerdown) can render the live preview. */
  dragPreview: { id: string; x: number; y: number; w: number; h: number } | null;
  setDragPreview: (
    preview: { id: string; x: number; y: number; w: number; h: number } | null,
  ) => void;
  /** id of whatever block is currently being dragged, regardless of mode.
   * Used purely to dim the original while it's picked up. */
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
  /** Transient alignment guide lines shown while freeform-dragging a block
   * whose edges line up with siblings or the parent container. */
  alignmentGuides: { parentId: string; guides: AlignmentGuide[] } | null;
  setAlignmentGuides: (
    guides: { parentId: string; guides: AlignmentGuide[] } | null,
  ) => void;
  loadDocument: (doc: DesignDocument) => void;
  reset: () => void;
  /** Sets the document's total page count (whole pages of pageSize.h
   * each). Refuses to go below what current content actually needs —
   * enforcePageBounds silently grows it back if you try. */
  setPageCount: (n: number) => void;
  /** Changes the document's page width (applies to every page). Updates
   * pageSize.w and root.w together — resizeNode alone would get
   * overwritten by enforcePageBounds, which always pins root.w to
   * pageSize.w. */
  setPageWidth: (w: number) => void;
  /** image kind only: attach/replace the picture and/or how it fills its
   * box. */
  updateImage: (id: string, patch: { imageSrc?: string; objectFit?: "cover" | "contain" }) => void;
  /** Declares a new template variable. Silently no-ops if the name is
   * invalid or already declared — callers (the Variables panel, the
   * insert-variable picker) are expected to validate/dedupe first and
   * surface that to the user themselves. */
  addVariable: (name: string, label: string, type?: VariableType, sampleValue?: string) => void;
  updateVariable: (id: string, patch: Partial<Omit<TemplateVariable, "id">>) => void;
  removeVariable: (id: string) => void;
  /** Batch AI/chat edits into a single undo step. */
  beginHistoryGroup: () => void;
  commitHistoryGroup: () => void;
  /** Re-run the WASM layout solver (used after batched design ops). */
  relayoutDocument: () => Promise<void>;
}

let layoutVersion = 0;

// --- Undo history -----------------------------------------------------
// Coalesces bursts of rapid changes (typing, dragging) into a single
// undo step: the "before" snapshot is captured once at the start of a
// burst, and only committed to `past` after 600ms of inactivity. A new
// burst immediately clears `future` (redo becomes invalid the moment you
// make a fresh edit), matching Figma/Docs-style undo behavior.
let historyTimer: ReturnType<typeof setTimeout> | null = null;
let historyBaseline: DesignDocument | null = null;
let historyGroupDepth = 0;
let historyGroupSnapshot: DesignDocument | null = null;
let relayoutSuppressDepth = 0;
let relayoutPending = false;
const HISTORY_LIMIT = 50;
const HISTORY_DEBOUNCE_MS = 600;

export const useEditorStore = create<EditorState>((set, get) => {
  function noteHistory() {
    if (historyGroupDepth > 0) {
      if (!historyGroupSnapshot) {
        historyGroupSnapshot = structuredClone(get().doc);
      }
      return;
    }
    const state = get();
    if (!historyBaseline) {
      historyBaseline = state.doc;
      set({ history: { past: state.history.past, future: [] } });
    }
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      const baseline = historyBaseline;
      historyBaseline = null;
      historyTimer = null;
      if (!baseline) return;
      set((s) => ({
        history: {
          past: [...s.history.past, baseline].slice(-HISTORY_LIMIT),
          future: s.history.future,
        },
      }));
    }, HISTORY_DEBOUNCE_MS);
  }

  async function relayout() {
    if (relayoutSuppressDepth > 0) {
      relayoutPending = true;
      return;
    }
    const myVersion = ++layoutVersion;
    set({ layoutPending: true });
    const root = structuredClone(get().doc.root);
    const result = await computeLayout(root);
    if (myVersion !== layoutVersion) return;
    enforcePageBounds(result, get().doc.pageSize);
    set((state) => ({
      doc: { ...state.doc, root: result },
      layoutPending: false,
    }));
  }

  async function flushRelayout() {
    if (!relayoutPending) return;
    relayoutPending = false;
    await relayout();
  }

  return {
    doc: createEmptyDocument(),
    selectedId: null,
    layoutPending: false,
    zoom: 1,
    history: { past: [], future: [] },
    showTemplatePicker: false,
    setShowTemplatePicker: (show) => set({ showTemplatePicker: show }),
    showVariablesPanel: false,
    setShowVariablesPanel: (show) => set({ showVariablesPanel: show }),
    previewMode: false,
    setPreviewMode: (preview) => set({ previewMode: preview }),

    undo: () => {
      // Flush any pending coalesced change first so "undo" always reverts
      // the most recent edit, not a stale pre-debounce snapshot.
      if (historyTimer) {
        clearTimeout(historyTimer);
        historyTimer = null;
        if (historyBaseline) {
          set((s) => ({
            history: { past: [...s.history.past, historyBaseline!].slice(-HISTORY_LIMIT), future: [] },
          }));
          historyBaseline = null;
        }
      }
      const { past, future } = get().history;
      if (past.length === 0) return;
      const previous = past[past.length - 1];
      set((state) => ({
        doc: previous,
        history: { past: past.slice(0, -1), future: [state.doc, ...future] },
        selectedId: null,
      }));
    },

    redo: () => {
      const { past, future } = get().history;
      if (future.length === 0) return;
      const next = future[0];
      set((state) => ({
        doc: next,
        history: { past: [...past, state.doc], future: future.slice(1) },
        selectedId: null,
      }));
    },

    dropTargetId: null,
    setDropTarget: (id) => {
      if (get().dropTargetId !== id) set({ dropTargetId: id });
    },
    dragAnchor: null,
    setDragAnchor: (anchor) => set({ dragAnchor: anchor }),
    dragPreview: null,
    setDragPreview: (preview) => set({ dragPreview: preview }),
    draggingId: null,
    setDraggingId: (id) => set({ draggingId: id }),
    alignmentGuides: null,
    setAlignmentGuides: (guides) => set({ alignmentGuides: guides }),

    setZoom: (zoom) => set({ zoom: Math.min(2, Math.max(0.25, zoom)) }),
    select: (id) => set({ selectedId: id }),

    addElement: (kind, parentId, x, y) => {
      noteHistory();
      let newId = "";
      set((state) => {
        const root = structuredClone(state.doc.root);
        const parent = findNode(root, parentId) ?? root;
        const node = createNode(kind, x, y);
        newId = node.id;
        parent.children.push(node);
        return { doc: { ...state.doc, root } };
      });
      set({ selectedId: newId });
      void relayout();
    },

    removeElement: (id) => {
      if (id === get().doc.root.id) return;
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const parent = findParent(root, id);
        if (parent) {
          parent.children = parent.children.filter((c) => c.id !== id);
        }
        return {
          doc: { ...state.doc, root },
          selectedId: state.selectedId === id ? null : state.selectedId,
        };
      });
      void relayout();
    },

    updateLabel: (id, label) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        if (node) node.label = label;
        return { doc: { ...state.doc, root } };
      });
    },

    updateStyle: (id, patch) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        if (node) node.style = { ...node.style, ...patch };
        return { doc: { ...state.doc, root } };
      });
    },

    updateNode: (id, patch) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        if (node) Object.assign(node, patch);
        enforcePageBounds(root, state.doc.pageSize);
        return { doc: { ...state.doc, root } };
      });
    },

    updateLevel: (id, level) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        if (node) {
          node.level = level;
          const preset = HEADING_LEVEL_PRESET[level];
          if (preset) node.style = { ...node.style, fontSize: preset.fontSize };
        }
        return { doc: { ...state.doc, root } };
      });
    },

    moveNode: (id, x, y) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        if (node) {
          node.x = x;
          node.y = y;
        }
        enforcePageBounds(root, state.doc.pageSize);
        return { doc: { ...state.doc, root } };
      });
    },

    resizeNode: (id, w, h) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        if (node) {
          node.w = Math.max(20, w);
          node.h = Math.max(20, h);
        }
        relayoutAfterResize(root, id, findParent);
        enforcePageBounds(root, state.doc.pageSize);
        return { doc: { ...state.doc, root } };
      });
    },

    updateBox: (id, box) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        if (node) {
          node.x = box.x;
          node.y = box.y;
          node.w = Math.max(20, box.w);
          node.h = Math.max(20, box.h);
        }
        relayoutAfterResize(root, id, findParent);
        enforcePageBounds(root, state.doc.pageSize);
        return { doc: { ...state.doc, root } };
      });
    },

    updateLayoutProps: (id, patch) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        if (node && node.layout) node.layout = { ...node.layout, ...patch };
        relayoutBranch(root, id, findParent);
        enforcePageBounds(root, state.doc.pageSize);
        return { doc: { ...state.doc, root } };
      });
    },

    toggleAutoLayout: (id, enabled) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        if (node) node.layout = enabled ? { ...DEFAULT_LAYOUT } : null;
        if (enabled) relayoutBranch(root, id, findParent);
        enforcePageBounds(root, state.doc.pageSize);
        return { doc: { ...state.doc, root } };
      });
    },

    reorderChild: (id, direction) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const parent = findParent(root, id);
        if (!parent) return { doc: state.doc };
        const idx = parent.children.findIndex((c) => c.id === id);
        const target = idx + direction;
        if (idx < 0 || target < 0 || target >= parent.children.length) {
          return { doc: state.doc };
        }
        const [node] = parent.children.splice(idx, 1);
        parent.children.splice(target, 0, node);
        relayoutBranch(root, parent.id, findParent);
        return { doc: { ...state.doc, root } };
      });
    },

    moveNodeInTree: (id, newParentId, index, position) => {
      if (id === "root") return;
      noteHistory();
      let needsRelayout = false;
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        const newParent = findNode(root, newParentId);
        if (!node || !newParent) return { doc: state.doc };
        if (isSelfOrDescendant(node, newParentId)) return { doc: state.doc };

        const oldParent = findParent(root, id);
        if (!oldParent) return { doc: state.doc };
        const changedParent = oldParent.id !== newParent.id;

        // Only re-run the WASM solver when an auto-layout container is
        // involved — a pure freeform move (including cross-container
        // drops between two freeform boxes) only changes authored x/y and
        // must not rearrange unrelated auto-layout siblings elsewhere on
        // the page.
        needsRelayout = oldParent.layout !== null || newParent.layout !== null;

        oldParent.children = oldParent.children.filter((c) => c.id !== id);

        if (position) {
          node.x = position.x;
          node.y = position.y;
        } else if (changedParent && newParent.layout === null) {
          const pos = nextStackedPosition(newParent);
          node.x = pos.x;
          node.y = pos.y;
        }

        const clampedIndex = Math.max(0, Math.min(index, newParent.children.length));
        newParent.children.splice(clampedIndex, 0, node);
        enforcePageBounds(root, state.doc.pageSize);

        if (needsRelayout) {
          if (changedParent) {
            relayoutBranch(root, oldParent.id, findParent);
            relayoutBranch(root, newParent.id, findParent);
          } else {
            relayoutBranch(root, newParent.id, findParent);
          }
        }

        return { doc: { ...state.doc, root } };
      });
    },

    loadDocument: (doc) => {
      noteHistory();
      const normalized = normalizeDocument(doc);
      set({ doc: structuredClone(normalized), selectedId: null });
      void relayout();
    },

    reset: () => {
      noteHistory();
      set({ doc: createEmptyDocument(), selectedId: null });
    },

    setPageCount: (n) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        root.h = Math.max(1, Math.round(n)) * state.doc.pageSize.h;
        enforcePageBounds(root, state.doc.pageSize);
        return { doc: { ...state.doc, root } };
      });
    },

    setPageWidth: (w) => {
      noteHistory();
      set((state) => {
        const width = Math.max(100, Math.round(w));
        const pageSize = { ...state.doc.pageSize, w: width };
        const root = structuredClone(state.doc.root);
        root.w = width;
        enforcePageBounds(root, pageSize);
        return { doc: { ...state.doc, pageSize, root } };
      });
    },

    updateImage: (id, patch) => {
      noteHistory();
      set((state) => {
        const root = structuredClone(state.doc.root);
        const node = findNode(root, id);
        if (node) {
          if (patch.imageSrc !== undefined) node.imageSrc = patch.imageSrc;
          if (patch.objectFit !== undefined) node.objectFit = patch.objectFit;
        }
        return { doc: { ...state.doc, root } };
      });
    },

    addVariable: (name, label, type = "text", sampleValue = "") => {
      const trimmed = name.trim();
      if (!isValidVariableName(trimmed)) return;
      if (get().doc.variables.some((v) => v.name === trimmed)) return;
      noteHistory();
      const sample =
        sampleValue ||
        (type === "list" ? "[]" : type === "object" ? "{}" : "");
      set((state) => ({
        doc: {
          ...state.doc,
          variables: [...state.doc.variables, createVariable(trimmed, label, type, sample)],
        },
      }));
    },

    updateVariable: (id, patch) => {
      noteHistory();
      set((state) => ({
        doc: {
          ...state.doc,
          variables: state.doc.variables.map((v) => (v.id === id ? { ...v, ...patch } : v)),
        },
      }));
    },

    removeVariable: (id) => {
      noteHistory();
      set((state) => ({
        doc: { ...state.doc, variables: state.doc.variables.filter((v) => v.id !== id) },
      }));
    },

    beginHistoryGroup: () => {
      historyGroupDepth += 1;
      relayoutSuppressDepth += 1;
      if (historyGroupDepth === 1 && !historyGroupSnapshot) {
        historyGroupSnapshot = structuredClone(get().doc);
      }
    },

    commitHistoryGroup: () => {
      if (historyGroupDepth <= 0) return;
      historyGroupDepth -= 1;
      relayoutSuppressDepth = Math.max(0, relayoutSuppressDepth - 1);
      if (historyGroupDepth === 0) {
        const snapshot = historyGroupSnapshot;
        historyGroupSnapshot = null;
        if (snapshot) {
          set((s) => ({
            history: {
              past: [...s.history.past, snapshot].slice(-HISTORY_LIMIT),
              future: [],
            },
          }));
        }
      }
      if (relayoutSuppressDepth === 0 && relayoutPending) {
        void flushRelayout();
      }
    },

    relayoutDocument: async () => {
      relayoutPending = true;
      await flushRelayout();
    },
  };
});

export { findNode, findParent, isSelfOrDescendant };
