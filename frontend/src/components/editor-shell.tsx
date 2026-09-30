"use client";

import { useEffect, useState } from "react";
import { PageEditor } from "@/components/page-editor";
import { TextDocumentEditor } from "@/components/text-document-editor";
import {
  isTextEditorFile,
  type EditorWritableHandle,
} from "@/lib/editor-files";
import { PRODUCT } from "@/lib/product-copy";
import { loadEditorFile } from "@/lib/workspace-session";

type Seed = {
  file: File;
  handle: EditorWritableHandle | null;
};

/**
 * Picks the page-stamp editor (PDF/image) or the text document editor (md/txt/csv)
 * from the handed-off IndexedDB file, and lets either surface open the other type.
 */
export function EditorShell() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"page" | "text">("page");
  const [seed, setSeed] = useState<Seed | null>(null);

  useEffect(() => {
    let alive = true;
    void loadEditorFile().then((file) => {
      if (!alive) return;
      if (file && isTextEditorFile(file)) {
        setSeed({ file, handle: null });
        setMode("text");
      } else if (file) {
        setSeed({ file, handle: null });
        setMode("page");
      }
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) {
    return (
      <div className="app-shell flex min-h-dvh flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="m-0 font-[family-name:var(--font-display)] text-3xl tracking-tight">
          {PRODUCT.editorLine}
        </h1>
        <p className="text-sm text-[var(--ink-muted)]">Loading editor…</p>
      </div>
    );
  }

  if (mode === "text") {
    return (
      <TextDocumentEditor
        initialFile={seed?.file ?? null}
        initialHandle={seed?.handle ?? null}
        onOpenPageFile={(file, handle) => {
          setSeed({ file, handle });
          setMode("page");
        }}
      />
    );
  }

  return (
    <PageEditor
      initialFile={seed?.file ?? null}
      initialHandle={seed?.handle ?? null}
      onOpenTextFile={(file, handle) => {
        setSeed({ file, handle });
        setMode("text");
      }}
    />
  );
}
