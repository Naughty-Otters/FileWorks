"use client";

import { useRef } from "react";
import { useEditorStore } from "../store";
import type { DesignDocument } from "../types";
import { normalizeDocument } from "../types";
import {
  IconSave,
  IconLoad,
  IconFile,
  IconTrash,
  IconCode,
  IconZoomIn,
  IconZoomOut,
  IconZoomReset,
  IconPrint,
  IconUndo,
  IconRedo,
  IconVariable,
  IconEye,
  IconEyeOff,
} from "../icons";

interface Props {
  name: string;
  onNameChange: (name: string) => void;
  onSave: () => void;
  saving: boolean;
  jsonPanelOpen: boolean;
  onToggleJsonPanel: () => void;
  onOpenOutputPreview: () => void;
  libraryHref?: string;
}

export default function Toolbar({
  name,
  onNameChange,
  onSave,
  saving,
  jsonPanelOpen,
  onToggleJsonPanel,
  onOpenOutputPreview,
  libraryHref = "/templates",
}: Props) {
  const selectedId = useEditorStore((s) => s.selectedId);
  const removeElement = useEditorStore((s) => s.removeElement);
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const setShowTemplatePicker = useEditorStore((s) => s.setShowTemplatePicker);
  const showVariablesPanel = useEditorStore((s) => s.showVariablesPanel);
  const setShowVariablesPanel = useEditorStore((s) => s.setShowVariablesPanel);
  const previewMode = useEditorStore((s) => s.previewMode);
  const setPreviewMode = useEditorStore((s) => s.setPreviewMode);
  const zoom = useEditorStore((s) => s.zoom);
  const setZoom = useEditorStore((s) => s.setZoom);
  const layoutPending = useEditorStore((s) => s.layoutPending);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.history.past.length > 0);
  const canRedo = useEditorStore((s) => s.history.future.length > 0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleLoadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      try {
        loadDocument(normalizeDocument(JSON.parse(text) as DesignDocument));
      } catch {
        alert("Invalid design JSON file.");
      }
    });
    e.target.value = "";
  }

  return (
    <div className="toolbar">
      <a href={libraryHref} className="library-link" title="Back to template library">
        ← Library
      </a>
      <input
        className="title-input"
        aria-label="Template name"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Untitled template"
      />
      <div className="toolbar-group">
        <button
          type="button"
          className="icon-btn"
          title="New document (choose a template)"
          onClick={() => setShowTemplatePicker(true)}
        >
          <IconFile />
        </button>
        <button
          type="button"
          className="icon-btn save-btn"
          title="Save template"
          disabled={saving}
          onClick={onSave}
        >
          <IconSave />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Import JSON"
          onClick={() => fileInputRef.current?.click()}
        >
          <IconLoad />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: "none" }}
          onChange={handleLoadFile}
        />
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button type="button" className="icon-btn" title="Undo (Ctrl/Cmd+Z)" disabled={!canUndo} onClick={undo}>
          <IconUndo />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Redo (Ctrl/Cmd+Shift+Z)"
          disabled={!canRedo}
          onClick={redo}
        >
          <IconRedo />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          type="button"
          className="icon-btn"
          title="Delete selected (Del)"
          disabled={!selectedId || selectedId === "root"}
          onClick={() => selectedId && removeElement(selectedId)}
        >
          <IconTrash />
        </button>
        <button
          type="button"
          className={`icon-btn${jsonPanelOpen ? " active" : ""}`}
          title="Edit document JSON"
          onClick={onToggleJsonPanel}
        >
          <IconCode />
        </button>
        <button type="button" className="icon-btn" title="Print document" onClick={() => window.print()}>
          <IconPrint />
        </button>
      </div>

      <div className="toolbar-divider" />

      <div className="toolbar-group">
        <button
          type="button"
          className={`icon-btn${showVariablesPanel ? " active" : ""}`}
          title="Variables — List, Object, Image open structured editors"
          onClick={() => setShowVariablesPanel(!showVariablesPanel)}
        >
          <IconVariable />
        </button>
        <button
          type="button"
          className={`icon-btn${previewMode ? " active" : ""}`}
          title={
            previewMode
              ? "Showing default values on the canvas — click to show {{ tokens }}"
              : "Canvas preview with default values"
          }
          onClick={() => setPreviewMode(!previewMode)}
        >
          {previewMode ? <IconEye /> : <IconEyeOff />}
        </button>
        <button
          type="button"
          className="chip-btn primary toolbar-preview-btn"
          title="Open the final generated document"
          onClick={onOpenOutputPreview}
        >
          Preview
        </button>
      </div>

      <div className="spacer" />

      <div className="toolbar-group">
        <button type="button" className="icon-btn" title="Zoom out" onClick={() => setZoom(zoom - 0.1)}>
          <IconZoomOut />
        </button>
        <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-btn" title="Zoom in" onClick={() => setZoom(zoom + 0.1)}>
          <IconZoomIn />
        </button>
        <button type="button" className="icon-btn" title="Reset zoom" onClick={() => setZoom(1)}>
          <IconZoomReset />
        </button>
      </div>

      <span className={`status${layoutPending ? " pending" : ""}`}>
        <span className="status-dot" />
        {layoutPending ? "solving layout…" : saving ? "saving…" : "ready"}
      </span>
    </div>
  );
}
