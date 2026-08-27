"use client";

import { Circle, ImagePlus, Minus, Square, Type } from "lucide-react";
import { useRef } from "react";
import type { EditorObject } from "@/lib/editor-regions";
import { cn } from "@/lib/utils";

type EditorInsertBarProps = {
  disabled?: boolean;
  onInsert: (object: EditorObject) => void;
  onInsertImage: (file: File) => void;
};

function InsertButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] transition",
        "hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]",
        "disabled:pointer-events-none disabled:opacity-35",
      )}
    >
      {children}
    </button>
  );
}

export function EditorInsertBar({ disabled, onInsert, onInsertImage }: EditorInsertBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div
      role="toolbar"
      aria-label="Insert"
      className="flex items-center gap-0.5 rounded-full border border-[var(--line)] bg-[var(--bg-panel)] px-1.5 py-0.5"
    >
      <InsertButton title="Insert text box" disabled={disabled} onClick={() => onInsert("text")}>
        <Type size={13} />
      </InsertButton>
      <InsertButton title="Insert image" disabled={disabled} onClick={() => fileRef.current?.click()}>
        <ImagePlus size={13} />
      </InsertButton>
      <InsertButton title="Insert rectangle" disabled={disabled} onClick={() => onInsert("rect")}>
        <Square size={13} />
      </InsertButton>
      <InsertButton title="Insert ellipse" disabled={disabled} onClick={() => onInsert("ellipse")}>
        <Circle size={13} />
      </InsertButton>
      <InsertButton title="Insert line" disabled={disabled} onClick={() => onInsert("line")}>
        <Minus size={13} />
      </InsertButton>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onInsertImage(file);
        }}
      />
    </div>
  );
}
