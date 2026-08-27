"use client";

import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Minus, Plus } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { EditorColorPalette } from "@/components/editor-color-palette";
import {
  FILL_WHITE,
  FONT_KIND_LABELS,
  FONT_KINDS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  applyEditorFont,
  fontSizePx,
  regionAlign,
  regionFill,
  regionObject,
  setFontSizePx,
  type EditorAlign,
  type EditorFont,
  type EditorRegion,
} from "@/lib/editor-regions";
import { cn } from "@/lib/utils";

type EditorStyleBarProps = {
  region: EditorRegion | null;
  pageHeightPx: number;
  onChange: (patch: Partial<EditorRegion>) => void;
  onHoldEdit?: () => void;
  onReleaseEdit?: () => void;
};

function keepEditFocus(event: MouseEvent, onHoldEdit?: () => void, onReleaseEdit?: () => void) {
  onHoldEdit?.();
  const target = event.target as HTMLElement;
  if (!target.closest("select")) event.preventDefault();
  const release = () => {
    onReleaseEdit?.();
    window.removeEventListener("mouseup", release);
  };
  window.addEventListener("mouseup", release);
}

function ToolButton({
  title,
  pressed,
  disabled,
  onClick,
  children,
}: {
  title: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] transition",
        "hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]",
        "disabled:pointer-events-none disabled:opacity-35",
        pressed && "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
      )}
    >
      {children}
    </button>
  );
}

export function EditorStyleBar({
  region,
  pageHeightPx,
  onChange,
  onHoldEdit,
  onReleaseEdit,
}: EditorStyleBarProps) {
  const disabled = !region;
  const object = region ? regionObject(region) : "text";
  const isText = object === "text";
  const size = region ? fontSizePx(region.font, pageHeightPx) : 12;
  const align = region ? regionAlign(region) : "left";
  const fill = region ? regionFill(region) : FILL_WHITE;

  function commitFont(patch: Partial<EditorFont>) {
    if (!region) return;
    onChange({ font: applyEditorFont(region.font, patch) });
  }

  function commitSize(next: number) {
    if (!region) return;
    onChange({ font: setFontSizePx(region.font, pageHeightPx, next) });
  }

  return (
    <div
      role="toolbar"
      aria-label="Text style"
      title={disabled ? "Click text to format" : "Text style"}
      data-editor-style-bar
      onMouseDown={(event) => keepEditFocus(event, onHoldEdit, onReleaseEdit)}
      className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-full border border-[var(--line)] bg-[var(--bg-panel)] px-1.5 py-0.5"
    >
      {isText ? (
        <>
          <select
            aria-label="Font"
            disabled={disabled}
            value={region?.font.kind || "helvetica"}
            onChange={(event) => commitFont({ kind: event.target.value as EditorFont["kind"] })}
            className="h-7 max-w-[8.5rem] rounded-md border-0 bg-transparent px-1 text-xs text-[var(--ink)] disabled:opacity-35"
          >
            {FONT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {FONT_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
          <ToolButton
            title="Smaller"
            disabled={disabled || size <= FONT_SIZE_MIN}
            onClick={() => commitSize(size - 1)}
          >
            <Minus size={13} />
          </ToolButton>
          <span role="status" aria-label="Font size" className="w-7 text-center text-xs tabular-nums text-[var(--ink)]">
            {size}
          </span>
          <ToolButton
            title="Larger"
            disabled={disabled || size >= FONT_SIZE_MAX}
            onClick={() => commitSize(size + 1)}
          >
            <Plus size={13} />
          </ToolButton>
          <ToolButton
            title="Bold"
            pressed={Boolean(region?.font.bold)}
            disabled={disabled}
            onClick={() => commitFont({ bold: !region?.font.bold })}
          >
            <Bold size={13} />
          </ToolButton>
          <ToolButton
            title="Italic"
            pressed={Boolean(region?.font.italic)}
            disabled={disabled}
            onClick={() => commitFont({ italic: !region?.font.italic })}
          >
            <Italic size={13} />
          </ToolButton>
          <ToolButton
            title="Align left"
            pressed={align === "left"}
            disabled={disabled}
            onClick={() => onChange({ align: "left" satisfies EditorAlign })}
          >
            <AlignLeft size={13} />
          </ToolButton>
          <ToolButton
            title="Align center"
            pressed={align === "center"}
            disabled={disabled}
            onClick={() => onChange({ align: "center" })}
          >
            <AlignCenter size={13} />
          </ToolButton>
          <ToolButton
            title="Align right"
            pressed={align === "right"}
            disabled={disabled}
            onClick={() => onChange({ align: "right" })}
          >
            <AlignRight size={13} />
          </ToolButton>
          <EditorColorPalette
            label="Text color"
            disabled={disabled}
            value={region ? { kind: "color", color: region.font.color } : { kind: "color", color: { r: 0, g: 0, b: 0 } }}
            onChange={(next) => {
              if (next.kind === "color") commitFont({ color: next.color });
            }}
          />
        </>
      ) : null}
      {object !== "image" ? (
        <EditorColorPalette
          label={isText ? "Fill" : "Color"}
          disabled={disabled}
          allowTransparent
          value={fill}
          onChange={(next) => {
            if (!region) return;
            if (!isText && next.kind === "color") {
              onChange({ fill: next, font: applyEditorFont(region.font, { color: next.color }) });
              return;
            }
            onChange({ fill: next });
          }}
        />
      ) : null}
    </div>
  );
}
