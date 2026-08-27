"use client";

import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import {
  RESIZE_HANDLES,
  fillCss,
  fontCss,
  moveNormBox,
  regionAriaLabel,
  regionAlign,
  regionDirty,
  regionFill,
  regionObject,
  resizeNormBox,
  type EditorFill,
  type EditorRegion,
  type ResizeHandle,
} from "@/lib/editor-regions";

const HANDLE_CURSOR: Record<ResizeHandle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

function handleStyle(handle: ResizeHandle): CSSProperties {
  const edge = "50%";
  const pos: CSSProperties = { position: "absolute", width: 9, height: 9, margin: -4 };
  if (handle.includes("n")) pos.top = 0;
  if (handle.includes("s")) pos.bottom = 0;
  if (handle.includes("e")) pos.right = 0;
  if (handle.includes("w")) pos.left = 0;
  if (handle === "n" || handle === "s") pos.left = edge;
  if (handle === "e" || handle === "w") pos.top = edge;
  if (handle === "n" || handle === "s") pos.transform = "translateX(-50%)";
  if (handle === "e" || handle === "w") pos.transform = "translateY(-50%)";
  return pos;
}

type EditorRegionLayerProps = {
  regions: EditorRegion[];
  activeId: string | null;
  selectedId: string | null;
  draft: string;
  pageHeightPx: number;
  onStartEdit: (region: EditorRegion) => void;
  onDraftChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onDismiss?: () => void;
  onBlurCommit?: () => void;
  onResize: (id: string, box: EditorRegion["box"]) => void;
  onGestureStart?: () => void;
  onGestureEnd?: () => void;
  onDelete?: () => void;
};

/** Cover original PDF glyphs while typing so the overlay is not a blurry double. */
export function overlayBackground(editing: boolean, painted: boolean, fill: EditorFill): string {
  if (editing) return fill.kind === "color" ? fillCss(fill) : "#ffffff";
  if (painted && fill.kind === "color") return fillCss(fill);
  return "transparent";
}

export function EditorRegionLayer({
  regions,
  activeId,
  selectedId,
  draft,
  pageHeightPx,
  onStartEdit,
  onDraftChange,
  onCommit,
  onCancel,
  onDismiss,
  onBlurCommit,
  onResize,
  onGestureStart,
  onGestureEnd,
  onDelete,
}: EditorRegionLayerProps) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!activeId) return;
    fieldRef.current?.focus({ preventScroll: true });
  }, [activeId]);

  function startMove(event: ReactPointerEvent, region: EditorRegion) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const page = (event.currentTarget as HTMLElement).closest("[data-editor-page]");
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY, box: { ...region.box } };
    let dragged = false;
    function move(next: PointerEvent) {
      const dist = Math.hypot(next.clientX - origin.x, next.clientY - origin.y);
      if (!dragged && dist < 5) return;
      if (!dragged) {
        dragged = true;
        onGestureStart?.();
      }
      const dx = (next.clientX - origin.x) / Math.max(1, rect.width);
      const dy = (next.clientY - origin.y) / Math.max(1, rect.height);
      onResize(region.id, moveNormBox(origin.box, dx, dy));
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (dragged) onGestureEnd?.();
      else onStartEdit(region);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startResize(event: ReactPointerEvent, region: EditorRegion, handle: ResizeHandle) {
    event.preventDefault();
    event.stopPropagation();
    const page = (event.currentTarget as HTMLElement).closest("[data-editor-page]");
    if (!page) return;
    const rect = page.getBoundingClientRect();
    const origin = { x: event.clientX, y: event.clientY, box: { ...region.box } };
    let started = false;
    function move(next: PointerEvent) {
      if (!started) {
        started = true;
        onGestureStart?.();
      }
      const dx = (next.clientX - origin.x) / Math.max(1, rect.width);
      const dy = (next.clientY - origin.y) / Math.max(1, rect.height);
      onResize(region.id, resizeNormBox(origin.box, handle, dx, dy));
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (started) onGestureEnd?.();
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div
      data-editor-page
      className="absolute inset-0 overflow-hidden"
      style={{ fontSize: 0, lineHeight: 0 }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onDismiss?.();
      }}
    >
      {regions.map((region) => {
        const object = regionObject(region);
        const editing = region.id === activeId && object === "text";
        const selected = region.id === selectedId;
        const dirty = regionDirty(region);
        const fill = regionFill(region);
        const painted = dirty || region.source === "draw";
        const covered = object === "text" && !region.text && region.source !== "draw";
        const sizePx = Math.max(6, region.font.nh * Math.max(pageHeightPx, 1));
        const typeStyle: CSSProperties = {
          ...fontCss(region.font),
          fontSize: sizePx,
          lineHeight: 1.15,
          textAlign: regionAlign(region),
          background: overlayBackground(editing, painted, fill),
        };
        if (covered) {
          return (
            <div
              key={region.id}
              data-editor-box
              className="pointer-events-none absolute"
              style={{
                left: `${region.box.x * 100}%`,
                top: `${region.box.y * 100}%`,
                width: `${region.box.w * 100}%`,
                height: `${region.box.h * 100}%`,
                background: fill.kind === "color" ? fillCss(fill) : "transparent",
              }}
            />
          );
        }
        return (
          <div
            key={region.id}
            data-editor-box
            className="absolute"
            style={{
              left: `${region.box.x * 100}%`,
              top: `${region.box.y * 100}%`,
              width: `${region.box.w * 100}%`,
              height: `${region.box.h * 100}%`,
            }}
          >
            {editing ? (
              <textarea
                ref={fieldRef}
                aria-label="Edit text"
                rows={1}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value.replace(/\n/g, " "))}
                onBlur={() => (onBlurCommit || onCommit)()}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onCancel();
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    onCommit();
                    return;
                  }
                  if ((event.key === "Backspace" || event.key === "Delete") && !draft) {
                    event.preventDefault();
                    onDelete?.();
                  }
                }}
                className="absolute inset-0 z-10 box-border h-full w-full resize-none overflow-hidden border border-[var(--accent)] px-0.5 py-0 outline-none"
                style={typeStyle}
              />
            ) : (
              <button
                type="button"
                aria-label={regionAriaLabel(region)}
                onPointerDown={(event) => startMove(event, region)}
                className={cn(
                  "absolute inset-0 box-border block overflow-hidden border",
                  selected || dirty
                    ? "border-[var(--accent)]"
                    : "border-transparent hover:border-[var(--accent)]",
                )}
                style={{
                  ...typeStyle,
                  borderRadius: object === "ellipse" ? "50%" : 0,
                  cursor: selected ? "grab" : "pointer",
                  touchAction: "none",
                }}
              >
                {object === "image" && region.imageSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={region.imageSrc} alt="" className="h-full w-full object-contain" />
                ) : object === "line" ? (
                  <span
                    className="absolute left-0 right-0 top-1/2 block h-[3px] -translate-y-1/2"
                    style={{ background: fontCss(region.font).color }}
                  />
                ) : object === "text" && painted ? (
                  region.text
                ) : null}
              </button>
            )}
            {selected ? (
              <>
                {RESIZE_HANDLES.map((handle) => (
                  <span
                    key={handle}
                    role="slider"
                    aria-label={`Resize ${handle}`}
                    tabIndex={0}
                    onPointerDown={(event) => startResize(event, region, handle)}
                    className="z-20 rounded-[1px] bg-[var(--accent)]"
                    style={{ ...handleStyle(handle), cursor: HANDLE_CURSOR[handle] }}
                  />
                ))}
              </>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
