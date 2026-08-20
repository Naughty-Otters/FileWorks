"use client";
import type { DesignNode, ElementKind } from "../types";
import { DND_MIME, isContainer, nextStackedPosition } from "../types";
import { useEditorStore, findNode, findParent } from "../store";
import {
  IconBoxShape,
  IconHeadingShape,
  IconParagraphShape,
  IconImageShape,
  IconVariable,
} from "../icons";

const SHAPES: { kind: ElementKind; label: string; icon: React.ComponentType }[] = [
  { kind: "box", label: "Box", icon: IconBoxShape },
  { kind: "heading", label: "Heading", icon: IconHeadingShape },
  { kind: "paragraph", label: "Paragraph", icon: IconParagraphShape },
  { kind: "image", label: "Image", icon: IconImageShape },
];

export default function Palette() {
  const selectedId = useEditorStore((s) => s.selectedId);
  const doc = useEditorStore((s) => s.doc);
  const addElement = useEditorStore((s) => s.addElement);
  const showVariablesPanel = useEditorStore((s) => s.showVariablesPanel);
  const setShowVariablesPanel = useEditorStore((s) => s.setShowVariablesPanel);
  const variableCount = useEditorStore((s) => s.doc.variables.length);

  /** The nearest container starting at `node` and walking up through
   * ancestors — so adding into a selected Heading/Paragraph lands it next
   * to its siblings in the enclosing Box, not back at the page root. */
  function nearestContainer(node: DesignNode | null): DesignNode {
    let current = node;
    while (current) {
      if (isContainer(current.kind)) return current;
      current = findParent(doc.root, current.id);
    }
    return doc.root;
  }

  function handleAdd(kind: ElementKind) {
    const selected = selectedId ? findNode(doc.root, selectedId) : null;
    const parent = nearestContainer(selected);
    const { x, y } = nextStackedPosition(parent);
    addElement(kind, parent.id, x, y);
  }

  return (
    <div className="palette">
      <h3>Add a block</h3>
      <div className="shape-grid">
        {SHAPES.map(({ kind, label, icon: Icon }) => (
          <button
            key={kind}
            className="shape-tile"
            title={`${label} — drag onto the page, or click to add`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_MIME, kind);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => handleAdd(kind)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <p className="palette-hint">
        Drag a block onto the page, or click one to drop it into the
        selected box.
      </p>

      <h3>Variables</h3>
      <button
        className={`panel-action-btn${showVariablesPanel ? " active" : ""}`}
        title="Open variables — List, Object, and Image use structured editors"
        onClick={() => setShowVariablesPanel(!showVariablesPanel)}
      >
        <IconVariable />
        <span>Edit variables</span>
        {variableCount > 0 && <span className="panel-action-badge">{variableCount}</span>}
      </button>
      <p className="palette-hint">List / Object / Image are added from the Variables dialog cards.</p>
    </div>
  );
}
