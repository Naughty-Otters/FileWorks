"use client";

import { useEffect, useRef, useState } from "react";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { markdownToHtml } from "@/lib/markdown-runtime";
import { cn } from "@/lib/utils";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
});
turndown.use(gfm);
turndown.addRule("keepDataImages", {
  filter: (node) =>
    node.nodeName === "IMG" &&
    typeof (node as HTMLImageElement).getAttribute("src") === "string" &&
    Boolean((node as HTMLImageElement).getAttribute("src")?.startsWith("data:")),
  replacement: (_content, node) => {
    const img = node as HTMLImageElement;
    const src = img.getAttribute("src") || "";
    const alt = img.getAttribute("alt") || "";
    return `![${alt}](${src})`;
  },
});

type EditableMarkdownPreviewProps = {
  markdown: string;
  onChange?: (value: string) => void;
  className?: string;
};

/**
 * Rendered Markdown preview that can be edited in place.
 * Markdown → HTML is async; the visible DOM is innerHTML, not a React fiber tree.
 */
export function EditableMarkdownPreview({
  markdown,
  onChange,
  className,
}: EditableMarkdownPreviewProps) {
  const editorRef = useRef<HTMLElement>(null);
  const requestRef = useRef(0);
  const userFocusedRef = useRef(false);
  const [focused, setFocused] = useState(false);
  const [rendering, setRendering] = useState(false);
  const editable = Boolean(onChange);

  useEffect(() => {
    if (focused || !editorRef.current) return;
    const requestId = ++requestRef.current;
    const target = editorRef.current;
    if (!markdown.trim()) {
      target.innerHTML = "";
      setRendering(false);
      return;
    }
    setRendering(true);
    void markdownToHtml(markdown)
      .then((html) => {
        if (requestId !== requestRef.current || !editorRef.current) return;
        editorRef.current.innerHTML = html;
      })
      .catch(() => {
        if (requestId !== requestRef.current || !editorRef.current) return;
        editorRef.current.textContent = markdown;
      })
      .finally(() => {
        if (requestId === requestRef.current) setRendering(false);
      });
  }, [markdown, focused]);

  function commitFromDom() {
    if (!editable || !editorRef.current || !onChange || !userFocusedRef.current) return;
    const html = editorRef.current.innerHTML.trim();
    if (!html || html === "<br>") {
      // Empty DOM usually means HTML has not painted yet — do not wipe the convert result.
      if (markdown.trim()) return;
      onChange("");
      return;
    }
    const next = turndown.turndown(html).replace(/\n{3,}/g, "\n\n").trimEnd();
    if (next !== markdown) onChange(next);
  }

  return (
    <div className={cn("relative h-full overflow-auto p-5 md:p-6", className)}>
      <article
        ref={editorRef}
        className={cn(
          "prose-result animate-rise min-h-full rounded-lg outline-none transition",
          editable && "cursor-text focus-visible:ring-1 focus-visible:ring-[var(--accent)]/40",
        )}
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck
        role="textbox"
        aria-multiline="true"
        aria-busy={rendering}
        aria-label="Editable Markdown preview"
        data-placeholder="Click to edit…"
        onFocus={() => {
          userFocusedRef.current = true;
          setFocused(true);
        }}
        onBlur={() => {
          commitFromDom();
          userFocusedRef.current = false;
          setFocused(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            (e.target as HTMLElement).blur();
          }
        }}
      />
      {editable ? (
        <p className="pointer-events-none sticky bottom-0 mt-3 text-[11px] text-[var(--ink-muted)]">
          Click the preview to edit in place · switch to Edit for raw Markdown
        </p>
      ) : null}
    </div>
  );
}
