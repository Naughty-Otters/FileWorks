"use client";

import {
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ChevronUp,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Quote,
  StretchHorizontal,
  Strikethrough,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRef } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { FormatCommand, FormatExtra } from "@/lib/markdown-format";

type MarkdownToolbarProps = {
  disabled?: boolean;
  onCommand: (command: FormatCommand, extra?: FormatExtra) => void;
  onHide: () => void;
};

function ToolButton({
  title,
  disabled,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-[var(--line)]" aria-hidden />;
}

function ToolGroup({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

export function MarkdownToolbar({ disabled, onCommand, onHide }: MarkdownToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  function insertImageFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image")) return;
      onCommand("image", { dataUrl, alt: file.name.replace(/\.[^.]+$/, "") || "image" });
    };
    reader.readAsDataURL(file);
  }

  function insertLink() {
    const url = window.prompt("Link URL", "https://");
    if (!url) return;
    onCommand("link", { url: url.trim() });
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-0.5 gap-y-1 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)] px-2 py-1">
      <ToolGroup>
        <ToolButton title="Bold" disabled={disabled} onClick={() => onCommand("bold")}>
          <Bold size={13} />
        </ToolButton>
        <ToolButton title="Italic" disabled={disabled} onClick={() => onCommand("italic")}>
          <Italic size={13} />
        </ToolButton>
        <ToolButton title="Strikethrough" disabled={disabled} onClick={() => onCommand("strike")}>
          <Strikethrough size={13} />
        </ToolButton>
        <ToolButton title="Inline code" disabled={disabled} onClick={() => onCommand("code")}>
          <Code size={13} />
        </ToolButton>
      </ToolGroup>
      <Divider />
      <ToolGroup>
        <ToolButton title="Heading 1" disabled={disabled} onClick={() => onCommand("h1")}>
          <Heading1 size={13} />
        </ToolButton>
        <ToolButton title="Heading 2" disabled={disabled} onClick={() => onCommand("h2")}>
          <Heading2 size={13} />
        </ToolButton>
        <ToolButton title="Heading 3" disabled={disabled} onClick={() => onCommand("h3")}>
          <Heading3 size={13} />
        </ToolButton>
      </ToolGroup>
      <Divider />
      <ToolGroup>
        <ToolButton title="Quote" disabled={disabled} onClick={() => onCommand("quote")}>
          <Quote size={13} />
        </ToolButton>
        <ToolButton title="Bullet list" disabled={disabled} onClick={() => onCommand("ul")}>
          <List size={13} />
        </ToolButton>
        <ToolButton title="Numbered list" disabled={disabled} onClick={() => onCommand("ol")}>
          <ListOrdered size={13} />
        </ToolButton>
        <ToolButton title="Horizontal rule" disabled={disabled} onClick={() => onCommand("hr")}>
          <Minus size={13} />
        </ToolButton>
      </ToolGroup>
      <Divider />
      <ToolGroup>
        <ToolButton title="Insert link" disabled={disabled} onClick={insertLink}>
          <Link2 size={13} />
        </ToolButton>
        <ToolButton
          title="Insert image"
          disabled={disabled}
          onClick={() => fileRef.current?.click()}
        >
          <ImagePlus size={13} />
        </ToolButton>
      </ToolGroup>
      <Divider />
      <ToolGroup>
        <ToolButton
          title="Smaller image"
          disabled={disabled}
          onClick={() => onCommand("img-smaller")}
        >
          <ZoomOut size={13} />
        </ToolButton>
        <ToolButton title="Larger image" disabled={disabled} onClick={() => onCommand("img-larger")}>
          <ZoomIn size={13} />
        </ToolButton>
        <ToolButton title="Image left" disabled={disabled} onClick={() => onCommand("img-left")}>
          <AlignLeft size={13} />
        </ToolButton>
        <ToolButton title="Image right" disabled={disabled} onClick={() => onCommand("img-right")}>
          <AlignRight size={13} />
        </ToolButton>
        <ToolButton title="Image inline" disabled={disabled} onClick={() => onCommand("img-inline")}>
          <StretchHorizontal size={13} />
        </ToolButton>
      </ToolGroup>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) insertImageFile(file);
        }}
      />
      <button
        type="button"
        title="Hide formatting toolbar"
        aria-label="Hide formatting toolbar"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onHide}
        className={cn(
          "ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]",
        )}
      >
        <ChevronUp size={12} />
        <span className="hidden sm:inline">Hide</span>
      </button>
    </div>
  );
}

export function ShowMarkdownToolbarButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="Show formatting toolbar"
      aria-label="Show formatting toolbar"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
    >
      <ChevronDown size={12} />
      <span className="hidden sm:inline">Format</span>
    </button>
  );
}
