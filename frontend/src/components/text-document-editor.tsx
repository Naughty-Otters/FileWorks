"use client";

import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { FolderOpen, Save, Upload } from "lucide-react";
import { AuthBar } from "@/components/auth-bar";
import { BrandLockup } from "@/components/brand-lockup";
import { DocsLiteEditor } from "@/components/docs-lite-editor";
import { PlanPolicyDialog } from "@/components/plan-policy-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  canUseFilePicker,
  classifyEditorFile,
  downloadBlob,
  EDITOR_ACCEPT,
  fileLooksLikeText,
  isMarkdownDocumentFile,
  isSourceOnlyTextFile,
  isTextEditorFile,
  pickEditorFile,
  pickSaveHandle,
  saveActionLabel,
  textMimeForName,
  writeFileHandle,
  type EditorWritableHandle,
} from "@/lib/editor-files";
import { docxFileToEditorMarkdown, isWordDocxFile } from "@/lib/docx-to-editor";
import { editorSaveGate, type ConvertGate } from "@/lib/plans";
import { PRODUCT } from "@/lib/product-copy";
import { reloadSession, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { loadEditorFile, saveEditorFile, saveSessionFile } from "@/lib/workspace-session";

const navLink =
  "rounded-full px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]";

type TextDocumentEditorProps = {
  /** When set, skip IndexedDB bootstrap and open this file immediately. */
  initialFile?: File | null;
  initialHandle?: EditorWritableHandle | null;
  onOpenPageFile?: (file: File, handle: EditorWritableHandle | null) => void;
};

export function TextDocumentEditor({
  initialFile = null,
  initialHandle = null,
  onOpenPageFile,
}: TextDocumentEditorProps) {
  const { me, status, displayUser } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<EditorWritableHandle | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [canOverwrite, setCanOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const [gate, setGate] = useState<ConvertGate | null>(null);
  const sourceOnly = Boolean(file && isSourceOnlyTextFile(file));
  const docsFormat = file && isMarkdownDocumentFile(file) ? "markdown" : "plain";
  const dirty = content !== baseline;
  const showDocs = mode === "preview" && !sourceOnly;

  useEffect(() => {
    void reloadSession();
  }, []);

  async function openText(next: File, handle: EditorWritableHandle | null) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (isWordDocxFile(next)) {
        const mdFile = await docxFileToEditorMarkdown(next);
        handleRef.current = null;
        setCanOverwrite(false);
        setFile(mdFile);
        const text = await mdFile.text();
        setContent(text);
        setBaseline(text);
        setMode("preview");
        setNotice(`Opened ${next.name} as ${mdFile.name}`);
        await saveEditorFile(mdFile);
        return;
      }
      let kind = classifyEditorFile(next);
      if (kind === "other" && (await fileLooksLikeText(next))) {
        kind = "text";
      }
      if (kind !== "text") {
        if (onOpenPageFile && (kind === "pdf" || kind === "image")) {
          onOpenPageFile(next, handle);
          return;
        }
        setError(
          kind === "office"
            ? "Excel, PowerPoint, and older Office files need Convert & edit from Home."
            : "This looks like a binary file. Open Markdown, text, Word (.docx), or a PDF/image.",
        );
        return;
      }
      const text = await next.text();
      handleRef.current = handle;
      setCanOverwrite(Boolean(handle));
      setFile(next);
      setContent(text);
      setBaseline(text);
      setMode(isSourceOnlyTextFile(next) ? "source" : "preview");
      await saveEditorFile(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t open this file.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (initialFile) {
        if (alive) await openText(initialFile, initialHandle);
        if (alive) setLoaded(true);
        return;
      }
      const handed = await loadEditorFile();
      if (!alive) return;
      if (handed && isTextEditorFile(handed)) await openText(handed, null);
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once
  }, []);

  async function onPick() {
    if (canUseFilePicker()) {
      const picked = await pickEditorFile();
      if (picked) await openText(picked.file, picked.handle);
      return;
    }
    inputRef.current?.click();
  }

  async function onInputChange(event: FormEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (next) await openText(next, null);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const next = event.dataTransfer.files?.[0];
    if (next) void openText(next, null);
  }

  async function persist(blob: Blob, name: string, handle: EditorWritableHandle | null) {
    if (handle && (await writeFileHandle(handle, blob))) {
      setNotice("Saved.");
      return true;
    }
    downloadBlob(blob, name);
    setNotice("Downloaded a copy.");
    return false;
  }

  async function onSave(modeSave: "save" | "save-as") {
    if (!file) return;
    const nextGate = editorSaveGate(me?.permissions?.["editor.download"]);
    if (nextGate !== "ready") {
      setGate(nextGate);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const mime = textMimeForName(file.name);
      const blob = new Blob([content], { type: mime });
      let handle = handleRef.current;
      if (modeSave === "save-as") {
        const picked = await pickSaveHandle(file.name);
        if (picked) {
          handle = picked;
          handleRef.current = picked;
        }
      }
      const wrote = await persist(blob, file.name, handle);
      const nextFile = new File([blob], file.name, { type: mime, lastModified: Date.now() });
      setFile(nextFile);
      setBaseline(content);
      setCanOverwrite(Boolean(handleRef.current) && wrote);
      await saveEditorFile(nextFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save this file.");
    } finally {
      setBusy(false);
    }
  }

  async function sendToProduce() {
    if (!file) return;
    const mime = textMimeForName(file.name);
    const blob = new Blob([content], { type: mime });
    const next = new File([blob], file.name, { type: mime, lastModified: Date.now() });
    await saveSessionFile(next);
    window.location.assign("/");
  }

  return (
    <div className="app-shell relative flex min-h-dvh flex-col">
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-2 px-4 py-2.5 md:px-6">
          <BrandLockup />
          <nav className="ml-1 hidden items-center gap-0.5 sm:flex">
            <a href="/" className={navLink}>
              Home
            </a>
            <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent-strong)]">
              {PRODUCT.editor}
            </span>
            <a href="/templates" className={navLink}>
              {PRODUCT.designs}
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <AuthBar me={me} status={status} user={displayUser} loginHref="/login?next=%2Fedit" />
            <ThemeToggle className="h-8 w-8" />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[1100px] flex-1 flex-col gap-4 px-4 py-5 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl tracking-tight sm:text-3xl">
              {PRODUCT.editor}
            </h1>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{PRODUCT.editorTextLine}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onPick()}
              disabled={busy}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 text-sm text-[var(--ink)] transition hover:border-[var(--accent)] disabled:opacity-50"
            >
              <FolderOpen size={15} aria-hidden />
              Open
            </button>
            {file ? (
              <>
                <button
                  type="button"
                  onClick={() => void onSave("save")}
                  disabled={busy || !dirty}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-sm font-medium text-white transition hover:bg-[var(--accent-strong)] disabled:opacity-50 dark:text-[#06281d]"
                >
                  <Save size={15} aria-hidden />
                  {saveActionLabel(canOverwrite)}
                </button>
                <button
                  type="button"
                  onClick={() => void onSave("save-as")}
                  disabled={busy}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 text-sm disabled:opacity-50"
                >
                  Save as
                </button>
                <button
                  type="button"
                  onClick={() => void sendToProduce()}
                  disabled={busy}
                  className="inline-flex h-9 items-center rounded-full border border-[var(--line)] px-3 text-sm disabled:opacity-50"
                >
                  {PRODUCT.needProduce}
                </button>
              </>
            ) : null}
          </div>
        </div>

        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        {notice ? <p className="text-sm text-[var(--ink-muted)]">{notice}</p> : null}

        <input
          ref={inputRef}
          type="file"
          accept={EDITOR_ACCEPT}
          className="hidden"
          onChange={(event) => void onInputChange(event)}
        />

        {!loaded ? (
          <p className="text-sm text-[var(--ink-muted)]">Loading…</p>
        ) : !file ? (
          <button
            type="button"
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => void onPick()}
            className={cn(
              "flex min-h-[18rem] flex-1 flex-col items-center justify-center gap-3 rounded-[1.75rem] border border-dashed px-6 text-center transition",
              dragging
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--line)] bg-[color-mix(in_oklab,var(--bg-panel)_90%,transparent)] hover:border-[var(--accent)]",
            )}
          >
            <Upload size={28} className="text-[var(--accent-strong)]" aria-hidden />
            <span className="text-sm font-medium text-[var(--ink)]">{PRODUCT.dropOrChoose}</span>
            <span className="max-w-sm text-xs leading-relaxed text-[var(--ink-muted)]">
              Text and Word (.docx) open in TipTap. CSV stays source-only. PDFs and images use the
              page editor; Excel/PowerPoint convert once from Home.
            </span>
          </button>
        ) : (
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-[var(--line)] bg-[var(--bg-panel)]">
            <header className="flex flex-wrap items-center gap-2 border-b border-[var(--line)] px-4 py-2.5">
              <p className="min-w-0 flex-1 truncate text-sm font-medium">{file.name}</p>
              {sourceOnly ? (
                <span className="text-[11px] text-[var(--ink-muted)]">Source only</span>
              ) : (
                <div className="inline-flex rounded-full border border-[var(--line)] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setMode("preview")}
                    className={cn(
                      "rounded-full px-2.5 py-1",
                      mode === "preview"
                        ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                        : "text-[var(--ink-muted)]",
                    )}
                  >
                    Document
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("source")}
                    className={cn(
                      "rounded-full px-2.5 py-1",
                      mode === "source"
                        ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                        : "text-[var(--ink-muted)]",
                    )}
                  >
                    Source
                  </button>
                </div>
              )}
              {dirty ? <span className="text-[11px] text-[var(--ink-muted)]">Unsaved</span> : null}
            </header>
            {showDocs ? (
              <DocsLiteEditor
                key={file.name}
                markdown={content}
                format={docsFormat}
                onChange={setContent}
                disabled={busy}
                className="min-h-[24rem]"
              />
            ) : (
              <textarea
                value={content}
                onChange={(event) => setContent(event.target.value)}
                spellCheck={false}
                className="min-h-[24rem] flex-1 resize-none bg-transparent px-5 py-4 font-mono text-sm leading-6 text-[var(--ink)] outline-none"
                aria-label="Document source"
              />
            )}
          </section>
        )}
      </main>
      {gate && gate !== "ready" ? (
        <PlanPolicyDialog gate={gate} onClose={() => setGate(null)} loginHref="/login?next=/edit" />
      ) : null}
    </div>
  );
}
