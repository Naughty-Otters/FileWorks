"use client";

// Resolved via next.config alias → mammoth.browser.js (Node "main" breaks in the browser).
import mammoth from "mammoth";
import { markdownEditName } from "@/lib/editor-files";
import { previewHtmlToMarkdown } from "@/lib/html-to-markdown";

/** Word Open XML (.docx) — openable in TipTap via client-side Mammoth. */
export function isWordDocxFile(file: { name: string; type?: string }): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (name.endsWith(".docx")) return true;
  return (
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

/**
 * Excel / PowerPoint / legacy .doc / ODF / RTF — still need server Convert & edit.
 * (Mammoth is DOCX-only; TipTap cannot open these packages.)
 */
export function isServerOfficeEditFile(file: { name: string; type?: string }): boolean {
  const name = file.name.toLowerCase();
  if (isWordDocxFile(file)) return false;
  return /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|epub)$/i.test(name);
}

/** DOCX → Markdown File for the Docs-lite editor (browser-only, no convert quota). */
export async function docxFileToEditorMarkdown(file: File): Promise<File> {
  const arrayBuffer = await file.arrayBuffer();
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
  const markdown = previewHtmlToMarkdown(html || "").trim() || "(empty document)";
  return new File([markdown], markdownEditName(file.name), {
    type: "text/markdown",
    lastModified: Date.now(),
  });
}
