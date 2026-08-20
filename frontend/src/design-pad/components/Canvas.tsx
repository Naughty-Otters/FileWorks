"use client";

import { useMemo } from "react";
import { useEditorStore, findNode } from "../store";
import { findDropContainerId } from "../dropTarget";
import { DND_MIME, type ElementKind } from "../types";
import { expandSampleDocument } from "../templating";
import ElementView from "./ElementView";

export default function Canvas() {
  const root = useEditorStore((s) => s.doc.root);
  const pageSize = useEditorStore((s) => s.doc.pageSize);
  const doc = useEditorStore((s) => s.doc);
  const zoom = useEditorStore((s) => s.zoom);
  const previewMode = useEditorStore((s) => s.previewMode);
  const select = useEditorStore((s) => s.select);
  const addElement = useEditorStore((s) => s.addElement);
  const setDropTarget = useEditorStore((s) => s.setDropTarget);

  const displayRoot = useMemo(
    () => (previewMode ? expandSampleDocument(doc).root : root),
    [previewMode, doc, root],
  );

  function handleDragOver(e: React.DragEvent) {
    if (previewMode) return;
    if (!e.dataTransfer.types.includes(DND_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropTarget(findDropContainerId(e.clientX, e.clientY) ?? "root");
  }

  function handleDragLeave() {
    setDropTarget(null);
  }

  function handleDrop(e: React.DragEvent) {
    if (previewMode) return;
    const kind = e.dataTransfer.getData(DND_MIME) as ElementKind;
    setDropTarget(null);
    if (!kind) return;
    e.preventDefault();

    const targetId = findDropContainerId(e.clientX, e.clientY) ?? "root";
    const parent = findNode(root, targetId) ?? root;
    const anchor =
      targetId === "root"
        ? document.querySelector(".shape.canvas-root")
        : document.querySelector(`.shape[data-id="${targetId}"]`);
    const rect = (anchor as Element).getBoundingClientRect();
    const x = Math.max(0, (e.clientX - rect.left) / zoom);
    const y = Math.max(0, (e.clientY - rect.top) / zoom);
    addElement(kind, parent.id, x, y);
  }

  const numPages = Math.max(1, Math.round(displayRoot.h / pageSize.h));

  return (
    <div
      className={`canvas-viewport${previewMode ? " previewing" : ""}`}
      onPointerDown={() => !previewMode && select(null)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div
        className="canvas-surface"
        style={{
          width: displayRoot.w * zoom,
          height: displayRoot.h * zoom,
          backgroundSize: `${20 * zoom}px ${20 * zoom}px`,
          pointerEvents: previewMode ? "none" : undefined,
        }}
      >
        <div
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
          }}
        >
          <ElementView node={displayRoot} parentIsFreeform zoom={zoom} />
        </div>

        {Array.from({ length: numPages }).map((_, i) => (
          <div key={i} className="page-number-tag" style={{ top: i * pageSize.h * zoom + 8 }}>
            Page {i + 1}
          </div>
        ))}
        {Array.from({ length: numPages - 1 }).map((_, i) => (
          <div
            key={`break-${i}`}
            className="page-break"
            style={{ top: (i + 1) * pageSize.h * zoom }}
          />
        ))}
      </div>
    </div>
  );
}
