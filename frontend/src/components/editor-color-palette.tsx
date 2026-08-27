"use client";

import { useEffect, useId, useRef, useState } from "react";
import { EDITOR_PALETTE, colorCss, colorsEqual, type EditorColor, type EditorFill } from "@/lib/editor-regions";
import { cn } from "@/lib/utils";

type EditorColorPaletteProps = {
  label: string;
  value: EditorFill;
  allowTransparent?: boolean;
  disabled?: boolean;
  onChange: (fill: EditorFill) => void;
};

export function EditorColorPalette({
  label,
  value,
  allowTransparent = false,
  disabled,
  onChange,
}: EditorColorPaletteProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const current = value.kind === "color" ? colorCss(value.color) : "transparent";

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function pick(color: EditorColor) {
    onChange({ kind: "color", color });
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex h-7 items-center gap-1 rounded-md px-1 text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] disabled:opacity-35"
      >
        <span
          className="h-4 w-4 rounded-[3px] border border-[var(--line)]"
          style={{
            background:
              value.kind === "none"
                ? "repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px"
                : current,
          }}
        />
        <span className="hidden text-[10px] uppercase tracking-wide sm:inline">{label}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={`${label} palette`}
          className="absolute left-0 top-8 z-40 w-[184px] rounded-xl border border-[var(--line)] bg-[var(--bg-panel)] p-2 shadow-[var(--shadow)]"
        >
          {allowTransparent ? (
            <button
              type="button"
              aria-pressed={value.kind === "none"}
              onClick={() => {
                onChange({ kind: "none" });
                setOpen(false);
              }}
              className={cn(
                "mb-1.5 flex h-6 w-full items-center gap-2 rounded-md px-1 text-left text-[11px] text-[var(--ink)] hover:bg-[var(--accent-soft)]",
                value.kind === "none" && "bg-[var(--accent-soft)]",
              )}
            >
              <span
                className="h-4 w-4 rounded-[3px] border border-[var(--line)]"
                style={{ background: "repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px" }}
              />
              Transparent
            </button>
          ) : null}
          <div role="group" aria-label={label} className="grid grid-cols-6 gap-1">
            {EDITOR_PALETTE.map((swatch) => {
              const selected = value.kind === "color" && colorsEqual(value.color, swatch.color);
              return (
                <button
                  key={swatch.id}
                  type="button"
                  title={swatch.label}
                  aria-label={swatch.label}
                  aria-pressed={selected}
                  onClick={() => pick(swatch.color)}
                  className={cn(
                    "h-5 w-5 rounded-[3px] border",
                    selected ? "border-[var(--accent)] ring-2 ring-[var(--accent-soft)]" : "border-[var(--line)]",
                  )}
                  style={{ background: colorCss(swatch.color) }}
                />
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
