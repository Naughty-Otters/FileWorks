"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { DocsLiteToolbar } from "@/components/docs-lite-toolbar";
import {
  docsLiteHtmlToMarkdown,
  docsLiteHtmlToPlain,
  docsLiteMarkdownToHtml,
  docsLitePlainFallbackHtml,
  prepareHtmlForTipTap,
} from "@/lib/docs-lite-markdown";
import { cn } from "@/lib/utils";

export type DocsLiteEditorHandle = {
  focus: () => void;
  getMarkdown: () => string;
  getEditor: () => Editor | null;
};

export type DocsLiteContentFormat = "markdown" | "plain";

type DocsLiteEditorProps = {
  markdown: string;
  /** markdown: MD↔HTML path. plain: keep file bytes as text (json, code, logs, …). */
  format?: DocsLiteContentFormat;
  onChange?: (markdown: string) => void;
  disabled?: boolean;
  className?: string;
  /** Hide the sticky formatting bar (tests / embeds). */
  hideToolbar?: boolean;
};

function editorLooksEmpty(editor: Editor): boolean {
  return !editor.getText().trim();
}

function serialize(format: DocsLiteContentFormat, editor: Editor): string {
  return format === "plain"
    ? docsLiteHtmlToPlain(editor.getHTML())
    : docsLiteHtmlToMarkdown(editor.getHTML());
}

export const DocsLiteEditor = forwardRef<DocsLiteEditorHandle, DocsLiteEditorProps>(
  function DocsLiteEditor(
    { markdown, format = "markdown", onChange, disabled, className, hideToolbar },
    ref,
  ) {
    // null until TipTap has been seeded — must not equal initial `markdown` or the
    // sync effect skips and the editor stays on empty <p></p>.
    const lastEmittedRef = useRef<string | null>(null);
    const seededEditorRef = useRef<Editor | null>(null);
    const applyingExternalRef = useRef(false);
    // TipTap emits onUpdate while creating an empty doc. If onChange is setState,
    // that would wipe the parent file content before we seed — gate until seeded.
    const allowEmitRef = useRef(false);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const formatRef = useRef(format);
    formatRef.current = format;
    const editable = Boolean(onChange) && !disabled;

    // TipTap recreates the editor when `extensions` identity changes — memoize.
    // StarterKit v3 already includes Link — disable it and configure ours once.
    const extensions = useMemo(
      () => [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          link: false,
        }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: { class: "docs-lite-link" },
        }),
        Image.configure({
          allowBase64: true,
          HTMLAttributes: { class: "docs-lite-image" },
        }),
        Placeholder.configure({
          placeholder: "Start writing…",
        }),
        Table.configure({ resizable: false }),
        TableRow,
        TableHeader,
        TableCell,
      ],
      [],
    );

    const editor = useEditor({
      extensions,
      content: "",
      // Keep initial editable true; toggle via setEditable so TipTap does not
      // recreate the instance when `busy` flips during file open.
      editable: true,
      editorProps: {
        attributes: {
          class: "docs-lite-prose outline-none",
          "aria-label": "Document",
        },
      },
      onUpdate: ({ editor: ed }) => {
        if (!onChangeRef.current || applyingExternalRef.current || !allowEmitRef.current) {
          return;
        }
        const next = serialize(formatRef.current, ed);
        lastEmittedRef.current = next;
        onChangeRef.current(next);
      },
      // Avoid SSR hydration mismatches in Next.
      immediatelyRender: false,
    });

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;
      editor.setEditable(editable);
    }, [editor, editable]);

    useEffect(() => {
      if (!editor || editor.isDestroyed) return;

      const sameMarkdown = markdown === lastEmittedRef.current;
      const sameEditor = seededEditorRef.current === editor;
      // TipTap may recreate the instance (Strict Mode / option churn) after we
      // already marked markdown as loaded — force re-seed if the view is blank.
      if (sameMarkdown && sameEditor && !(markdown.trim() && editorLooksEmpty(editor))) {
        return;
      }

      let cancelled = false;
      applyingExternalRef.current = true;
      allowEmitRef.current = false;

      void (async () => {
        try {
          // Always seed plain first so the page is never stuck on the placeholder.
          if (markdown.trim()) {
            editor.commands.setContent(docsLitePlainFallbackHtml(markdown), {
              emitUpdate: false,
            });
          } else {
            editor.commands.setContent("<p></p>", { emitUpdate: false });
          }
          if (cancelled || editor.isDestroyed) return;

          if (format === "markdown") {
            const html = prepareHtmlForTipTap(await docsLiteMarkdownToHtml(markdown));
            if (cancelled || editor.isDestroyed) return;
            editor.commands.setContent(html || "<p></p>", { emitUpdate: false });
            if (markdown.trim() && editorLooksEmpty(editor)) {
              editor.commands.setContent(docsLitePlainFallbackHtml(markdown), {
                emitUpdate: false,
              });
            }
          }

          if (cancelled || editor.isDestroyed) return;
          lastEmittedRef.current = markdown;
          seededEditorRef.current = editor;
          allowEmitRef.current = Boolean(onChangeRef.current);
        } catch {
          if (cancelled || editor.isDestroyed) return;
          editor.commands.setContent(docsLitePlainFallbackHtml(markdown), {
            emitUpdate: false,
          });
          lastEmittedRef.current = markdown;
          seededEditorRef.current = editor;
          allowEmitRef.current = Boolean(onChangeRef.current);
        } finally {
          if (!cancelled) applyingExternalRef.current = false;
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [editor, markdown, format]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => editor?.commands.focus(),
        getMarkdown: () =>
          editor ? serialize(formatRef.current, editor) : lastEmittedRef.current ?? "",
        getEditor: () => editor,
      }),
      [editor],
    );

    return (
      <div className={cn("docs-lite flex min-h-0 flex-1 flex-col", className)}>
        {hideToolbar ? null : <DocsLiteToolbar editor={editor} disabled={!editable} />}
        <div className="docs-lite-scroll min-h-0 flex-1 overflow-auto">
          <div className="docs-lite-page mx-auto my-6 min-h-[24rem] w-full max-w-[45rem] rounded-sm px-8 py-10 sm:px-12 sm:py-12">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
    );
  },
);

DocsLiteEditor.displayName = "DocsLiteEditor";
