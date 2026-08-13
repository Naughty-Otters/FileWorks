"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { markdownToHtml } from "@/lib/markdown-runtime";
import { cn } from "@/lib/utils";
import type { FormatCommand, FormatExtra } from "@/lib/markdown-format";

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
    const cls = img.getAttribute("class") || "";
    const style = img.getAttribute("style") || "";
    const width =
      /(?:^|;)\s*width:\s*(\d+)px/i.exec(style)?.[1] || img.getAttribute("width") || "";
    const align = /\bfw-img-right\b/.test(cls) ? "right" : /\bfw-img-left\b/.test(cls) ? "left" : "";
    const title = [width, align].filter(Boolean).join(" ");
    return title ? `![${alt}](${src} "${title}")` : `![${alt}](${src})`;
  },
});

type EditableMarkdownPreviewProps = {
  markdown: string;
  onChange?: (value: string) => void;
  className?: string;
};

export type MarkdownPreviewHandle = {
  focus: () => void;
  applyCommand: (command: FormatCommand, extra?: FormatExtra) => void;
};

/**
 * Rendered Markdown preview that can be edited in place.
 * Markdown → HTML is async; the visible DOM is innerHTML, not a React fiber tree.
 */
export const EditableMarkdownPreview = forwardRef<MarkdownPreviewHandle, EditableMarkdownPreviewProps>(
  function EditableMarkdownPreview({ markdown, onChange, className }, ref) {
    const editorRef = useRef<HTMLElement>(null);
    const requestRef = useRef(0);
    const userFocusedRef = useRef(false);
    const lastImageRef = useRef<HTMLImageElement | null>(null);
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
      if (!editable || !editorRef.current || !onChange) return;
      const html = editorRef.current.innerHTML.trim();
      if (!html || html === "<br>") {
        if (markdown.trim()) return;
        onChange("");
        return;
      }
      const next = turndown.turndown(html).replace(/\n{3,}/g, "\n\n").trimEnd();
      if (next !== markdown) onChange(next);
    }

    function activeImage(): HTMLImageElement | null {
      const selection = window.getSelection();
      const node = selection?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const fromSelection = el?.closest?.("img");
      if (fromSelection instanceof HTMLImageElement) return fromSelection;
      const clicked = lastImageRef.current;
      if (clicked && editorRef.current?.contains(clicked)) return clicked;
      return editorRef.current?.querySelector("img") ?? null;
    }

    function scaleImage(img: HTMLImageElement, factor: number) {
      const current =
        Number.parseInt(img.getAttribute("width") || "", 10) ||
        Math.round(img.getBoundingClientRect().width) ||
        160;
      const width = Math.round(Math.min(720, Math.max(48, current * factor)));
      img.setAttribute("width", String(width));
      img.style.width = `${width}px`;
      img.style.maxWidth = "100%";
      img.style.height = "auto";
      img.style.objectFit = "contain";
    }

    function setImageAlign(img: HTMLImageElement, align: "left" | "right" | "") {
      img.classList.remove("fw-img-left", "fw-img-right");
      if (align === "left") img.classList.add("fw-img-left");
      if (align === "right") img.classList.add("fw-img-right");
    }

    useImperativeHandle(ref, () => ({
      focus() {
        editorRef.current?.focus();
      },
      applyCommand(command, extra) {
        if (!editable || !editorRef.current) return;
        userFocusedRef.current = true;
        editorRef.current.focus();
        const img = activeImage();

        if (command === "image" && extra?.dataUrl) {
          const alt = extra.alt || "image";
          document.execCommand(
            "insertHTML",
            false,
            `<img src="${extra.dataUrl}" alt="${alt.replace(/"/g, "")}" width="200" style="width:200px;max-width:100%;height:auto;object-fit:contain" />`,
          );
          commitFromDom();
          return;
        }
        if (command.startsWith("img-") && img) {
          if (command === "img-smaller") scaleImage(img, 0.8);
          if (command === "img-larger") scaleImage(img, 1.25);
          if (command === "img-left") setImageAlign(img, "left");
          if (command === "img-right") setImageAlign(img, "right");
          if (command === "img-inline") setImageAlign(img, "");
          lastImageRef.current = img;
          commitFromDom();
          return;
        }

        const block: Partial<Record<FormatCommand, string>> = {
          h1: "h1",
          h2: "h2",
          h3: "h3",
          quote: "blockquote",
        };
        const inline: Partial<Record<FormatCommand, string>> = {
          bold: "bold",
          italic: "italic",
          strike: "strikeThrough",
          code: "insertHTML",
        };
        if (command === "code") {
          const text = window.getSelection()?.toString() || "code";
          document.execCommand("insertHTML", false, `<code>${text}</code>`);
        } else if (inline[command] && command !== "code") {
          document.execCommand(inline[command]!, false);
        } else if (block[command]) {
          document.execCommand("formatBlock", false, block[command]);
        } else if (command === "ul") {
          document.execCommand("insertUnorderedList", false);
        } else if (command === "ol") {
          document.execCommand("insertOrderedList", false);
        } else if (command === "hr") {
          document.execCommand("insertHorizontalRule", false);
        } else if (command === "link") {
          const href = extra?.url || window.prompt("Link URL", "https://") || "";
          if (href) document.execCommand("createLink", false, href);
        }
        commitFromDom();
      },
    }));

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
          onMouseDown={(event) => {
            const target = event.target;
            if (target instanceof HTMLImageElement) lastImageRef.current = target;
          }}
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
            Select text or click an image, then use the toolbar
          </p>
        ) : null}
      </div>
    );
  },
);
EditableMarkdownPreview.displayName = "EditableMarkdownPreview";
