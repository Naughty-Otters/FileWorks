"use client";

import {
  Bold,
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
  Strikethrough,
  Table,
} from "lucide-react";
import { useRef, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { cn } from "@/lib/utils";

type DocsLiteToolbarProps = {
  editor: Editor | null;
  disabled?: boolean;
};

function ToolButton({
  title,
  disabled,
  active,
  onClick,
  children,
}: {
  title: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition disabled:pointer-events-none disabled:opacity-35",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
          : "text-[var(--ink-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]",
      )}
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

export function DocsLiteToolbar({ editor, disabled }: DocsLiteToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const off = disabled || !editor;

  function insertImageFile(file: File) {
    if (!editor) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl.startsWith("data:image")) return;
      editor
        .chain()
        .focus()
        .setImage({ src: dataUrl, alt: file.name.replace(/\.[^.]+$/, "") || "image" })
        .run();
    };
    reader.readAsDataURL(file);
  }

  function insertLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous || "https://");
    if (url === null) return;
    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run();
  }

  return (
    <div className="docs-lite-toolbar flex shrink-0 flex-wrap items-center gap-x-0.5 gap-y-1 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--bg-elevated)_85%,transparent)] px-3 py-1.5">
      <ToolGroup>
        <ToolButton
          title="Heading 1"
          disabled={off}
          active={editor?.isActive("heading", { level: 1 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        >
          <Heading1 size={14} strokeWidth={1.85} />
        </ToolButton>
        <ToolButton
          title="Heading 2"
          disabled={off}
          active={editor?.isActive("heading", { level: 2 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        >
          <Heading2 size={14} strokeWidth={1.85} />
        </ToolButton>
        <ToolButton
          title="Heading 3"
          disabled={off}
          active={editor?.isActive("heading", { level: 3 })}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        >
          <Heading3 size={14} strokeWidth={1.85} />
        </ToolButton>
      </ToolGroup>
      <Divider />
      <ToolGroup>
        <ToolButton
          title="Bold"
          disabled={off}
          active={editor?.isActive("bold")}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <Bold size={14} strokeWidth={1.85} />
        </ToolButton>
        <ToolButton
          title="Italic"
          disabled={off}
          active={editor?.isActive("italic")}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <Italic size={14} strokeWidth={1.85} />
        </ToolButton>
        <ToolButton
          title="Strikethrough"
          disabled={off}
          active={editor?.isActive("strike")}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <Strikethrough size={14} strokeWidth={1.85} />
        </ToolButton>
        <ToolButton
          title="Inline code"
          disabled={off}
          active={editor?.isActive("code")}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
          <Code size={14} strokeWidth={1.85} />
        </ToolButton>
      </ToolGroup>
      <Divider />
      <ToolGroup>
        <ToolButton
          title="Bullet list"
          disabled={off}
          active={editor?.isActive("bulletList")}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          <List size={14} strokeWidth={1.85} />
        </ToolButton>
        <ToolButton
          title="Numbered list"
          disabled={off}
          active={editor?.isActive("orderedList")}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered size={14} strokeWidth={1.85} />
        </ToolButton>
        <ToolButton
          title="Quote"
          disabled={off}
          active={editor?.isActive("blockquote")}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          <Quote size={14} strokeWidth={1.85} />
        </ToolButton>
        <ToolButton
          title="Divider"
          disabled={off}
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        >
          <Minus size={14} strokeWidth={1.85} />
        </ToolButton>
        <ToolButton
          title="Table"
          disabled={off}
          active={editor?.isActive("table")}
          onClick={() =>
            editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
          }
        >
          <Table size={14} strokeWidth={1.85} />
        </ToolButton>
      </ToolGroup>
      <Divider />
      <ToolGroup>
        <ToolButton title="Link" disabled={off} active={editor?.isActive("link")} onClick={insertLink}>
          <Link2 size={14} strokeWidth={1.85} />
        </ToolButton>
        <ToolButton title="Image" disabled={off} onClick={() => fileRef.current?.click()}>
          <ImagePlus size={14} strokeWidth={1.85} />
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
    </div>
  );
}
