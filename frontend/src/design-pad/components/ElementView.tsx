"use client";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { DesignNode } from "../types";
import { isContainer, isTextKind } from "../types";
import { useEditorStore, findNode, findParent } from "../store";
import { collectIds, resolveDragAnchor, shapeAncestorPath } from "../dropTarget";
import { readAndDownscaleImage } from "../imageUtils";
import { isPureVariableToken } from "../templating";
import { effectiveDefault } from "../defaults";
import { renderTokenizedText } from "./TokenizedText";
import { IconUpload, IconVariable } from "../icons";
import { computeAlignmentSnap } from "../alignmentGuides";
import AlignmentGuides from "./AlignmentGuides";

interface Props {
  node: DesignNode;
  parentIsFreeform: boolean;
  zoom: number;
}

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
const RESIZE_DIRS: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
const GRID = 8;
const CLICK_THRESHOLD = 4;
const snap = (v: number) => Math.round(v / GRID) * GRID;

/** Computes the resized box for a drag delta, then clamps it so it can
 * never overflow its parent's left/right edge — the box shrinks instead
 * of extending past the page (or containing box) boundary. Vertical
 * growth is deliberately left unclamped here: the store's
 * enforcePageBounds grows the page to fit instead of cutting content
 * off, since a page can always gain another sheet but never gain width. */
function applyResize(
  dir: ResizeDir,
  start: { x: number; y: number; w: number; h: number },
  dx: number,
  dy: number,
  parentInnerWidth: number,
) {
  let w = start.w;
  let h = start.h;
  if (dir.includes("e")) w = start.w + dx;
  if (dir.includes("w")) w = start.w - dx;
  if (dir.includes("s")) h = start.h + dy;
  if (dir.includes("n")) h = start.h - dy;
  w = Math.max(20, snap(w));
  h = Math.max(20, snap(h));
  let x = snap(dir.includes("w") ? start.x + (start.w - w) : start.x);
  const y = snap(dir.includes("n") ? start.y + (start.h - h) : start.y);

  if (x < 0) {
    w = Math.max(20, w + x);
    x = 0;
  }
  if (x + w > parentInnerWidth) {
    w = Math.max(20, parentInnerWidth - x);
  }

  return { x, y, w, h };
}

function elementRectFor(id: string): DOMRect | null {
  const el =
    id === "root"
      ? document.querySelector(".shape.canvas-root")
      : document.querySelector(`.shape[data-id="${id}"]`);
  return el ? el.getBoundingClientRect() : null;
}

/** One block in the document. Renders itself, and — if it's a container —
 * recurses into its children using the positions the WASM layout engine
 * (or freeform authoring) already computed. */
export default function ElementView({ node, parentIsFreeform, zoom }: Props) {
  const selectedId = useEditorStore((s) => s.selectedId);
  const dropTargetId = useEditorStore((s) => s.dropTargetId);
  const dragAnchor = useEditorStore((s) => s.dragAnchor);
  const dragPreview = useEditorStore((s) => s.dragPreview);
  const draggingId = useEditorStore((s) => s.draggingId);
  const alignmentGuides = useEditorStore((s) => s.alignmentGuides);
  const select = useEditorStore((s) => s.select);
  const updateLabel = useEditorStore((s) => s.updateLabel);
  const updateBox = useEditorStore((s) => s.updateBox);
  const updateImage = useEditorStore((s) => s.updateImage);
  const previewMode = useEditorStore((s) => s.previewMode);
  const variables = useEditorStore((s) => s.doc.variables);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [resizeBox, setResizeBox] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    dir: ResizeDir;
    box: { x: number; y: number; w: number; h: number };
  } | null>(null);

  const selected = selectedId === node.id;
  const isDropTarget = dropTargetId === node.id || (dragAnchor?.parentId === node.id && dragAnchor.zone === "into");
  const anchorZone = dragAnchor?.anchorId === node.id ? dragAnchor.zone : null;
  const isDragging = draggingId === node.id;
  const container = isContainer(node.kind);
  const textKind = isTextKind(node.kind);
  const isImage = node.kind === "image";
  const isRoot = node.id === "root";

  // An image's whole `imageSrc` can be a single `{{ name }}` token — a
  // variable standing in for the picture, resolved later by a rendering
  // engine (or, here, by this editor's own Preview mode against the
  // variable's sample value).
  const imageVarName = isImage ? isPureVariableToken(node.imageSrc ?? "") : null;
  const imageVar = imageVarName ? variables.find((v) => v.name === imageVarName) : undefined;
  const imageMode: "empty" | "literal" | "var-token" | "var-resolved" | "var-unset" = imageVarName
    ? previewMode
      ? imageVar && effectiveDefault(imageVar)
        ? "var-resolved"
        : "var-unset"
      : "var-token"
    : node.imageSrc
      ? "literal"
      : "empty";
  const resolvedImageSrc =
    imageMode === "var-resolved" && imageVar ? effectiveDefault(imageVar) : node.imageSrc;
  // A box with no fill and no border has no visual presence — it's being
  // used as a plain structural wrapper (e.g. grouping two fields into a
  // row). Showing a caption chip on top of it would just overlap its
  // content, so skip it; the Layers panel still shows the name.
  const showCaption =
    container && (node.style.backgroundColor !== "transparent" || node.style.borderStyle !== "none");
  const structureOnly =
    container &&
    !isRoot &&
    node.style.backgroundColor === "transparent" &&
    node.style.borderStyle === "none";

  const livePos = dragPreview?.id === node.id ? dragPreview : null;
  const x = livePos?.x ?? resizeBox?.x ?? node.x;
  const y = livePos?.y ?? resizeBox?.y ?? node.y;
  const w = resizeBox?.w ?? node.w;
  const h = resizeBox?.h ?? node.h;

  /** Click selects the outermost block on a fresh click; once that block
   * (or something inside it) is already selected, a plain click drills to
   * the exact thing under the cursor, while a drag always moves whatever
   * is currently selected — so grabbing any part of an already-selected
   * group moves the whole group, not just the piece your cursor landed
   * on. This mirrors Figma's click-to-enter-a-group model. */
  function onPointerDownBody(e: React.PointerEvent) {
    if (isRoot || editing || previewMode) return;
    e.stopPropagation();

    const path = shapeAncestorPath(e.currentTarget as Element).filter((id) => id !== "root");
    if (path.length === 0) return;

    const state = useEditorStore.getState();
    const alreadyInside = state.selectedId != null && path.includes(state.selectedId);
    const dragCandidateId = alreadyInside ? state.selectedId! : path[0];

    const root = state.doc.root;
    const dragNode = findNode(root, dragCandidateId);
    if (!dragNode) return;
    const excludeIds = collectIds(dragNode);

    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startBox = { x: dragNode.x, y: dragNode.y, w: dragNode.w, h: dragNode.h };
    let moved = false;

    // Grab offset (in screen pixels) from the pointer to the dragged
    // node's own top-left corner, captured once at drag start. Using this
    // instead of "cursor position = new corner" keeps the same point of
    // the box under the cursor throughout the drag, even if it crosses
    // into a different container with a different coordinate origin.
    const dragScreenRect = elementRectFor(dragCandidateId);
    const grabOffsetX = dragScreenRect ? startX - dragScreenRect.left : 0;
    const grabOffsetY = dragScreenRect ? startY - dragScreenRect.top : 0;

    const dragStartParentId = findParent(root, dragCandidateId)?.id ?? "root";
    const dragStartParentRect = elementRectFor(dragStartParentId);

    function resolveDrop(clientX: number, clientY: number) {
      return resolveDragAnchor(
        useEditorStore.getState().doc.root,
        clientX,
        clientY,
        excludeIds,
        dragStartParentId,
        dragStartParentRect,
      );
    }

    function cornerPosition(clientX: number, clientY: number, targetParentId: string) {
      const targetRect = elementRectFor(targetParentId);
      const cornerScreenX = clientX - grabOffsetX;
      const cornerScreenY = clientY - grabOffsetY;
      const nx = targetRect ? (cornerScreenX - targetRect.left) / zoom : startBox.x;
      const ny = targetRect ? (cornerScreenY - targetRect.top) / zoom : startBox.y;
      const gridX = snap(Math.max(0, nx));
      const gridY = snap(Math.max(0, ny));

      const parent = findNode(useEditorStore.getState().doc.root, targetParentId);
      const siblings =
        parent?.children
          .filter((c) => c.id !== dragCandidateId)
          .map((c) => ({ x: c.x, y: c.y, w: c.w, h: c.h })) ?? [];
      const parentBounds = parent ? { w: parent.w, h: parent.h } : null;

      return computeAlignmentSnap(
        { x: gridX, y: gridY, w: startBox.w, h: startBox.h },
        siblings,
        parentBounds,
      );
    }

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > CLICK_THRESHOLD) {
        moved = true;
        useEditorStore.getState().select(dragCandidateId);
        useEditorStore.getState().setDraggingId(dragCandidateId);
      }
      if (!moved) return;

      const resolved = resolveDrop(ev.clientX, ev.clientY);
      if (resolved?.targetIsFreeform) {
        const { x: nx, y: ny, guides } = cornerPosition(
          ev.clientX,
          ev.clientY,
          resolved.anchor.parentId,
        );
        useEditorStore
          .getState()
          .setDragPreview({ id: dragCandidateId, x: nx, y: ny, w: startBox.w, h: startBox.h });
        useEditorStore.getState().setAlignmentGuides(
          guides.length > 0
            ? { parentId: resolved.anchor.parentId, guides }
            : null,
        );
        useEditorStore.getState().setDragAnchor(null);
        useEditorStore.getState().setDropTarget(resolved.anchor.parentId);
      } else {
        useEditorStore.getState().setDragPreview(null);
        useEditorStore.getState().setAlignmentGuides(null);
        useEditorStore.getState().setDragAnchor(resolved?.anchor ?? null);
        useEditorStore.getState().setDropTarget(null);
      }
    }

    function onUp(ev: PointerEvent) {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const s = useEditorStore.getState();

      if (!moved) {
        const finalSel = alreadyInside ? path[path.length - 1] : path[0];
        s.select(finalSel);
      } else {
        const resolved = resolveDrop(ev.clientX, ev.clientY);
        if (resolved) {
          if (resolved.targetIsFreeform) {
            const { x: nx, y: ny } = cornerPosition(
              ev.clientX,
              ev.clientY,
              resolved.anchor.parentId,
            );
            const oldParent = findParent(s.doc.root, dragCandidateId);
            if (oldParent?.id === resolved.anchor.parentId) {
              // Same freeform container — only x/y changed. Use the cheap
              // path that skips the WASM relayout pass so unrelated
              // auto-layout boxes on the page stay put.
              s.moveNode(dragCandidateId, nx, ny);
            } else {
              s.moveNodeInTree(dragCandidateId, resolved.anchor.parentId, Number.MAX_SAFE_INTEGER, {
                x: nx,
                y: ny,
              });
            }
          } else {
            s.moveNodeInTree(dragCandidateId, resolved.anchor.parentId, resolved.anchor.index);
          }
        }
      }
      s.setDragPreview(null);
      s.setDragAnchor(null);
      s.setDropTarget(null);
      s.setDraggingId(null);
      s.setAlignmentGuides(null);
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onPointerDownResize(dir: ResizeDir) {
    return (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      select(node.id);
      (e.target as Element).setPointerCapture(e.pointerId);

      const state = useEditorStore.getState();
      const parent = findParent(state.doc.root, node.id);
      const parentInnerWidth = parent
        ? parent.layout
          ? Math.max(20, parent.w - 2 * parent.layout.padding)
          : parent.w
        : state.doc.root.w;

      resizeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        dir,
        box: { x: node.x, y: node.y, w: node.w, h: node.h },
      };

      function onMove(ev: PointerEvent) {
        if (!resizeRef.current) return;
        const dx = (ev.clientX - resizeRef.current.startX) / zoom;
        const dy = (ev.clientY - resizeRef.current.startY) / zoom;
        setResizeBox(
          applyResize(resizeRef.current.dir, resizeRef.current.box, dx, dy, parentInnerWidth),
        );
      }
      function onUp(ev: PointerEvent) {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (resizeRef.current) {
          const dx = (ev.clientX - resizeRef.current.startX) / zoom;
          const dy = (ev.clientY - resizeRef.current.startY) / zoom;
          const box = applyResize(
            resizeRef.current.dir,
            resizeRef.current.box,
            dx,
            dy,
            parentInnerWidth,
          );
          updateBox(node.id, box);
        }
        resizeRef.current = null;
        setResizeBox(null);
      }
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  const style: CSSProperties = isRoot
    ? {
        position: "relative",
        width: w,
        height: h,
        backgroundColor: node.style.backgroundColor,
      }
    : {
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: h,
        cursor: "move",
        opacity: isDragging && !livePos ? 0.4 : undefined,
        backgroundColor:
          node.style.backgroundColor !== "transparent"
            ? node.style.backgroundColor
            : undefined,
        border:
          node.style.borderStyle !== "none" && node.style.borderWidth > 0
            ? `${node.style.borderWidth}px ${node.style.borderStyle} ${node.style.borderColor}`
            : undefined,
      };

  const textStyle: CSSProperties = {
    fontFamily: node.style.fontFamily,
    fontSize: node.style.fontSize,
    color: node.style.color,
    fontWeight: node.style.bold ? 700 : 400,
    fontStyle: node.style.italic ? "italic" : "normal",
    textDecoration: node.style.underline || node.style.link ? "underline" : "none",
    textAlign: node.style.align,
  };

  return (
    <div
      className={`shape shape-${node.kind}${selected ? " selected" : ""}${isRoot ? " canvas-root" : ""}${parentIsFreeform && !isRoot ? " freeform" : ""}${isDropTarget ? " drop-target" : ""}${anchorZone ? ` anchor-${anchorZone}` : ""}${structureOnly ? " structure-only" : ""}`}
      data-id={node.id}
      style={style}
      onPointerDown={onPointerDownBody}
      onDoubleClick={(e) => {
        if (isRoot) return;
        e.stopPropagation();
        select(node.id);
        if (isImage) fileInputRef.current?.click();
        else setEditing(true);
      }}
    >
      {!isRoot && showCaption && !editing && (
        <span className="container-caption">
          {renderTokenizedText(node.label, previewMode, variables)}
        </span>
      )}
      {!isRoot && container && editing && (
        <input
          className="container-caption-input"
          autoFocus
          defaultValue={node.label}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            updateLabel(node.id, e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      )}

      {textKind && !editing && (
        <span
          className={`text-content${node.kind === "paragraph" ? " wrap" : " single-line"}`}
          style={textStyle}
        >
          {renderTokenizedText(node.label, previewMode, variables)}
        </span>
      )}
      {textKind && editing && node.kind === "heading" && (
        <input
          className="text-edit-input"
          style={textStyle}
          autoFocus
          defaultValue={node.label}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            updateLabel(node.id, e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      )}
      {textKind && editing && node.kind === "paragraph" && (
        <textarea
          className="text-edit-textarea"
          style={textStyle}
          autoFocus
          defaultValue={node.label}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => {
            updateLabel(node.id, e.target.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
        />
      )}

      {isImage && (
        <>
          {(imageMode === "literal" || imageMode === "var-resolved") && (
            <img
              className="image-content"
              src={resolvedImageSrc}
              alt=""
              draggable={false}
              style={{ objectFit: node.objectFit ?? "cover" }}
            />
          )}
          {imageMode === "var-token" && (
            <div className="image-placeholder var-image-placeholder">
              <IconVariable />
              <span className="var-token">{imageVarName}</span>
            </div>
          )}
          {imageMode === "var-unset" && (
            <div className="image-placeholder">
              <IconUpload />
              <span>No sample image set for “{imageVarName}”</span>
            </div>
          )}
          {imageMode === "empty" && (
            <div className="image-placeholder">
              <IconUpload />
              <span>Double-click to add a photo</span>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="image-file-input"
            onPointerDown={(e) => e.stopPropagation()}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              const dataUrl = await readAndDownscaleImage(file);
              updateImage(node.id, { imageSrc: dataUrl });
            }}
          />
        </>
      )}

      {container && (
        <div className="shape-children">
          {alignmentGuides?.parentId === node.id && (
            <AlignmentGuides
              guides={alignmentGuides.guides}
              width={node.w}
              height={node.h}
            />
          )}
          {node.children.length === 0 && !editing && (
            <div className="empty-container-hint">Drop blocks here</div>
          )}
          {node.children.map((child) => (
            <ElementView
              key={child.id}
              node={child}
              parentIsFreeform={node.layout === null}
              zoom={zoom}
            />
          ))}
        </div>
      )}

      {selected &&
        !isRoot &&
        RESIZE_DIRS.map((dir) => (
          <div
            key={dir}
            className={`resize-handle handle-${dir}`}
            onPointerDown={onPointerDownResize(dir)}
          />
        ))}
    </div>
  );
}
