"use client";
import { createContext, useContext, useState } from "react";
import { useEditorStore, findParent } from "../store";
import type { DesignNode, ElementKind } from "../types";
import { isContainer, isTextKind } from "../types";
import { IconBoxShape, IconHeadingShape, IconParagraphShape, IconImageShape } from "../icons";

const KIND_ICON: Record<ElementKind, React.ComponentType> = {
  box: IconBoxShape,
  heading: IconHeadingShape,
  paragraph: IconParagraphShape,
  image: IconImageShape,
};

type Zone = "before" | "after" | "into";

interface DndState {
  draggingId: string | null;
  overId: string | null;
  overZone: Zone | null;
}

interface DndCtx extends DndState {
  setDragging: (id: string | null) => void;
  setOver: (id: string | null, zone: Zone | null) => void;
  commit: () => void;
}

const Ctx = createContext<DndCtx | null>(null);

export default function Layers() {
  const doc = useEditorStore((s) => s.doc);
  const moveNodeInTree = useEditorStore((s) => s.moveNodeInTree);
  const [state, setState] = useState<DndState>({
    draggingId: null,
    overId: null,
    overZone: null,
  });

  function commit() {
    const { draggingId, overId, overZone } = state;
    if (draggingId && overId && overZone) {
      if (overZone === "into") {
        moveNodeInTree(draggingId, overId, Number.MAX_SAFE_INTEGER);
      } else {
        const overParent = findParent(doc.root, overId);
        if (overParent) {
          const idx = overParent.children.findIndex((c) => c.id === overId);
          const insertIdx = overZone === "before" ? idx : idx + 1;
          moveNodeInTree(draggingId, overParent.id, insertIdx);
        }
      }
    }
    setState({ draggingId: null, overId: null, overZone: null });
  }

  const ctx: DndCtx = {
    ...state,
    setDragging: (id) => setState((s) => ({ ...s, draggingId: id })),
    setOver: (overId, overZone) => setState((s) => ({ ...s, overId, overZone })),
    commit,
  };

  return (
    <div className="layers">
      <h3>Layers</h3>
      <div className="layers-tree">
        <Ctx.Provider value={ctx}>
          <LayerRow node={doc.root} depth={0} isRoot />
        </Ctx.Provider>
      </div>
    </div>
  );
}

function LayerRow({
  node,
  depth,
  isRoot,
}: {
  node: DesignNode;
  depth: number;
  isRoot?: boolean;
}) {
  const ctx = useContext(Ctx) as DndCtx;
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);
  const [expanded, setExpanded] = useState(true);
  const container = isContainer(node.kind);
  const Icon = KIND_ICON[node.kind] as React.ComponentType | undefined;
  const selected = selectedId === node.id;
  const isOver = ctx.overId === node.id && ctx.draggingId !== node.id;

  function handleDragStart(e: React.DragEvent) {
    e.stopPropagation();
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", node.id);
    ctx.setDragging(node.id);
  }

  function handleDragOver(e: React.DragEvent) {
    if (!ctx.draggingId || ctx.draggingId === node.id) return;
    e.preventDefault();
    e.stopPropagation();
    let zone: Zone;
    if (isRoot) {
      zone = "into";
    } else {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      if (container && ratio > 0.25 && ratio < 0.75) zone = "into";
      else zone = ratio <= 0.5 ? "before" : "after";
    }
    ctx.setOver(node.id, zone);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    ctx.commit();
  }

  function handleDragEnd() {
    ctx.setDragging(null);
    ctx.setOver(null, null);
  }

  return (
    <div className="layer-branch">
      <div
        className={`layer-row${selected ? " selected" : ""}${isOver ? ` drag-over-${ctx.overZone}` : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable={!isRoot}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={handleDragEnd}
        onClick={() => select(node.id)}
      >
        {container ? (
          <button
            className="layer-caret"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            {node.children.length > 0 ? (expanded ? "▾" : "▸") : ""}
          </button>
        ) : (
          <span className="layer-caret" />
        )}
        {Icon && <Icon />}
        <span className="layer-label">
          {isRoot ? "Page" : isTextKind(node.kind) ? node.kind : node.label || node.kind}
          {node.repeat ? " ↻" : ""}
        </span>
      </div>
      {container && expanded && node.children.length > 0 && (
        <div className="layer-children">
          {node.children.map((child) => (
            <LayerRow key={child.id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
