"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
} from "react";
import { FolderOpen, Redo2, Save, Undo2, Upload } from "lucide-react";
import { AuthBar } from "@/components/auth-bar";
import { BrandLockup } from "@/components/brand-lockup";
import { EditorInsertBar } from "@/components/editor-insert-bar";
import { EditorRegionLayer } from "@/components/editor-region-layer";
import { EditorStyleBar } from "@/components/editor-style-bar";
import { PlanPolicyDialog } from "@/components/plan-policy-dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DEFAULT_EXTRACT_OPTIONS,
  extractDocument,
  type ExtractOptions,
} from "@/lib/api";
import {
  canUseFilePicker,
  classifyEditorFile,
  downloadBlob,
  EDITOR_ACCEPT,
  pickEditorFile,
  pickSaveHandle,
  saveActionLabel,
  writeFileHandle,
  type EditorFileKind,
  type EditorWritableHandle,
} from "@/lib/editor-files";
import {
  extractPdfRegions,
  isPasswordPdfError,
  isRenderCancelled,
  openPdfDocument,
  renderPdfPage,
  renderPdfPageBlob,
  renderPdfThumbs,
  type OpenedPdf,
} from "@/lib/editor-pdf";
import {
  EMPTY_HISTORY,
  applyDraft,
  rememberRegions,
  redoRegions,
  undoRegions,
} from "@/lib/editor-history";
import {
  FILL_WHITE,
  anyRegionDirty,
  makeDrawnRegion,
  markRegionsClean,
  pageHasSelectableText,
  regionObject,
  regionsFromOcrExtract,
  type EditorObject,
  type EditorRegion,
} from "@/lib/editor-regions";
import { stampImageFile, stampPdfBytes } from "@/lib/editor-save";
import { type ConvertGate } from "@/lib/plans";
import { PRODUCT } from "@/lib/product-copy";
import { reloadSession, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";
import { loadEditorFile, saveEditorFile, saveSessionFile } from "@/lib/workspace-session";

const OCR_OPTIONS: ExtractOptions = {
  ...DEFAULT_EXTRACT_OPTIONS,
  use_ai: true,
  use_region_detection: true,
};

const navLink =
  "rounded-full px-2.5 py-1.5 text-xs text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]";

export function PageEditor() {
  const { me, status, displayUser } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<OpenedPdf | null>(null);
  const pdfBytesRef = useRef<ArrayBuffer | null>(null);
  const handleRef = useRef<EditorWritableHandle | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const draftRef = useRef("");
  const styleHoldRef = useRef(false);
  const regionsRef = useRef<EditorRegion[]>([]);
  const historyRef = useRef(EMPTY_HISTORY);
  const boxGestureRef = useRef(false);

  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<EditorFileKind | null>(null);
  const [rejected, setRejected] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [pageIndex, setPageIndex] = useState(0);
  const [regions, setRegions] = useState<EditorRegion[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pagePx, setPagePx] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [canOverwrite, setCanOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [ocrAsk, setOcrAsk] = useState<null | "page" | "all">(null);
  const [gate, setGate] = useState<ConvertGate | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [docEpoch, setDocEpoch] = useState(0);
  const [history, setHistory] = useState(EMPTY_HISTORY);

  regionsRef.current = regions;
  historyRef.current = history;

  const dirty = anyRegionDirty(regions);
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;
  const page = pageIndex + 1;
  const pageRegions = regions.filter((region) => region.page === page);
  const selectedRegion = regions.find((region) => region.id === selectedId) ?? null;
  const selectable = pageHasSelectableText(regions, page);
  const needsFindText = Boolean(file && kind && !selectable && !pageRegions.some((r) => r.source === "ocr"));

  const closePdf = useCallback(() => {
    try {
      pdfRef.current?.destroy();
    } catch {
      // pdf.js teardown is best-effort; don't mask the open/save error.
    }
    pdfRef.current = null;
    pdfBytesRef.current = null;
  }, []);

  const commitActive = useCallback(() => {
    const id = activeIdRef.current;
    if (!id) return;
    const text = draftRef.current;
    setRegions((prev) => prev.map((region) => (region.id === id ? { ...region, text } : region)));
    activeIdRef.current = null;
    setActiveId(null);
  }, []);

  const cancelActive = useCallback(() => {
    activeIdRef.current = null;
    setActiveId(null);
  }, []);

  const dismissSelection = useCallback(() => {
    commitActive();
    setSelectedId(null);
  }, [commitActive]);

  const commitUnlessStyling = useCallback(() => {
    if (styleHoldRef.current) return;
    commitActive();
  }, [commitActive]);

  function resetHistory() {
    historyRef.current = EMPTY_HISTORY;
    setHistory(EMPTY_HISTORY);
  }

  function flushedRegions(): EditorRegion[] {
    return applyDraft(regionsRef.current, activeIdRef.current, draftRef.current);
  }

  function rememberNow(current: EditorRegion[] = flushedRegions()) {
    const next = rememberRegions(historyRef.current, current);
    historyRef.current = next;
    setHistory(next);
  }

  function applyHistoryResult(result: { history: typeof history; regions: EditorRegion[] } | null) {
    if (!result) return;
    activeIdRef.current = null;
    draftRef.current = "";
    setActiveId(null);
    setDraft("");
    historyRef.current = result.history;
    setHistory(result.history);
    regionsRef.current = result.regions;
    setRegions(result.regions);
    setSelectedId((id) => (id && result.regions.some((region) => region.id === id) ? id : null));
  }

  const undo = useCallback(() => {
    applyHistoryResult(
      undoRegions(historyRef.current, applyDraft(regionsRef.current, activeIdRef.current, draftRef.current)),
    );
  }, []);

  const redo = useCallback(() => {
    applyHistoryResult(
      redoRegions(historyRef.current, applyDraft(regionsRef.current, activeIdRef.current, draftRef.current)),
    );
  }, []);

  const paintPdfPage = useCallback(async (index: number) => {
    const doc = pdfRef.current;
    const canvas = canvasRef.current;
    const wrap = viewportRef.current;
    if (!doc || !canvas || !wrap) return;
    const width = Math.max(320, Math.min(wrap.clientWidth - 24, 960));
    await renderPdfPage(doc, index + 1, canvas, width);
    setPagePx(canvas.clientHeight || canvas.height);
    setError((prev) => (prev === "Couldn’t draw this page." ? null : prev));
  }, []);

  const openSource = useCallback(
    async (next: File, handle: EditorWritableHandle | null) => {
      commitActive();
      resetHistory();
      setError(null);
      setNotice(null);
      setRejected(null);
      setActiveId(null);
      setSelectedId(null);
      setThumbs([]);
      const nextKind = classifyEditorFile(next);
      if (nextKind === "office" || nextKind === "other") {
        closePdf();
        setFile(null);
        setKind(null);
        setRegions([]);
        setImageUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        setRejected(next);
        handleRef.current = null;
        setCanOverwrite(false);
        return;
      }
      setBusy(true);
      try {
        closePdf();
        setImageUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return null;
        });
        handleRef.current = handle;
        setCanOverwrite(Boolean(handle));
        setFile(next);
        setKind(nextKind);
        setPageIndex(0);
        await saveEditorFile(next);
        if (nextKind === "pdf") {
          const bytes = await next.arrayBuffer();
          pdfBytesRef.current = bytes.slice(0);
          const doc = await openPdfDocument(bytes);
          pdfRef.current = doc;
          setPageCount(doc.pageCount);
          const found = await extractPdfRegions(doc);
          setRegions(found);
          setNotice(found.some((r) => r.source === "pdf") ? "Text on this page." : null);
          setDocEpoch((n) => n + 1);
          void renderPdfThumbs(doc)
            .then((urls) => {
              setThumbs(urls);
              setDocEpoch((n) => n + 1);
            })
            .catch(() => setThumbs([]));
        } else {
          setPageCount(1);
          setRegions([]);
          setImageUrl(URL.createObjectURL(next));
        }
      } catch (err) {
        closePdf();
        setFile(null);
        setKind(null);
        setRegions([]);
        if (isPasswordPdfError(err)) {
          setError("This PDF is password-protected.");
        } else {
          setError(err instanceof Error ? err.message : "Couldn’t open this file.");
        }
      } finally {
        setBusy(false);
      }
    },
    [closePdf, commitActive],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const handed = await loadEditorFile();
      if (!alive) return;
      if (handed) await openSource(handed, null);
      if (alive) setLoaded(true);
    })();
    return () => {
      alive = false;
    };
    // Load once on mount. Do not destroy the PDF here — React Strict Mode
    // unmounts immediately and would cancel the first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      closePdf();
    };
  }, [closePdf]);

  useEffect(() => {
    if (kind !== "pdf" || !pdfRef.current) return;
    let cancelled = false;
    void paintPdfPage(pageIndex).catch((err) => {
      if (cancelled || isRenderCancelled(err)) return;
      setError("Couldn’t draw this page.");
    });
    return () => {
      cancelled = true;
    };
  }, [kind, pageIndex, docEpoch, paintPdfPage]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.key === "Escape") {
        cancelActive();
        return;
      }
      if ((event.key === "Backspace" || event.key === "Delete") && !activeId) {
        event.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [activeId, cancelActive, selectedId, regions, undo, redo]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function takeFiles(list: FileList | null) {
    const next = list?.[0];
    if (next) void openSource(next, null);
  }

  async function onOpen() {
    if (canUseFilePicker()) {
      const picked = await pickEditorFile();
      if (picked) await openSource(picked.file, picked.handle);
      return;
    }
    inputRef.current?.click();
  }

  function startEdit(region: EditorRegion) {
    if (regionObject(region) !== "text") {
      const flushed = flushedRegions();
      if (activeIdRef.current) {
        regionsRef.current = flushed;
        setRegions(flushed);
        activeIdRef.current = null;
        setActiveId(null);
      }
      setSelectedId(region.id);
      return;
    }
    if (activeIdRef.current === region.id) {
      setSelectedId(region.id);
      return;
    }
    const flushed = flushedRegions();
    if (activeIdRef.current) {
      regionsRef.current = flushed;
      setRegions(flushed);
    }
    rememberNow(flushed);
    setSelectedId(region.id);
    const live = flushed.find((item) => item.id === region.id) ?? region;
    activeIdRef.current = region.id;
    draftRef.current = live.text;
    setActiveId(region.id);
    setDraft(live.text);
  }

  function resizeRegion(id: string, box: EditorRegion["box"]) {
    setRegions((prev) => prev.map((region) => (region.id === id ? { ...region, box } : region)));
    setSelectedId(id);
  }

  function patchSelected(patch: Partial<EditorRegion>) {
    if (!selectedId) return;
    const flushed = flushedRegions();
    rememberNow(flushed);
    const next = flushed.map((region) => (region.id === selectedId ? { ...region, ...patch } : region));
    regionsRef.current = next;
    setRegions(next);
  }

  function insertDrawn(object: EditorObject, imageSrc?: string) {
    if (!file) return;
    const flushed = flushedRegions();
    if (activeIdRef.current) {
      regionsRef.current = flushed;
      setRegions(flushed);
      activeIdRef.current = null;
      setActiveId(null);
    }
    rememberNow(flushed);
    const region = makeDrawnRegion({ page, object, existing: flushed, imageSrc });
    const next = [...flushed, region];
    regionsRef.current = next;
    setRegions(next);
    setSelectedId(region.id);
    if (object === "text") {
      activeIdRef.current = region.id;
      draftRef.current = region.text;
      setActiveId(region.id);
      setDraft(region.text);
    } else {
      activeIdRef.current = null;
      setActiveId(null);
    }
  }

  function insertImageFile(next: File) {
    if (next.size > 8_000_000) {
      setError("That image is too large.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : "";
      if (!src.startsWith("data:image")) {
        setError("Couldn’t read this image.");
        return;
      }
      insertDrawn("image", src);
    };
    reader.onerror = () => setError("Couldn’t read this image.");
    reader.readAsDataURL(next);
  }

  function deleteSelected() {
    if (!selectedId) return;
    const flushed = flushedRegions();
    const current = flushed.find((region) => region.id === selectedId);
    if (!current) return;
    rememberNow(flushed);
    const next =
      current.source === "draw"
        ? flushed.filter((region) => region.id !== selectedId)
        : flushed.map((region) =>
            region.id === selectedId ? { ...region, text: "", fill: FILL_WHITE } : region,
          );
    regionsRef.current = next;
    setRegions(next);
    activeIdRef.current = null;
    setActiveId(null);
    setSelectedId(null);
    draftRef.current = "";
    setDraft("");
  }

  function ocrGate(): ConvertGate {
    if (!me?.user) return "login";
    if (!me.permissions["extract.ai"]) return "plan";
    if (me.quota.remaining_ai_day === 0) return "quota_ai_day";
    if (me.quota.remaining_ai_month === 0) return "quota_ai_month";
    return "ready";
  }

  function requestFindText(scope: "page" | "all") {
    const nextGate = ocrGate();
    if (nextGate !== "ready") {
      setGate(nextGate);
      return;
    }
    setOcrAsk(scope);
  }

  async function runFindText(scope: "page" | "all") {
    if (!file || !kind) return;
    setOcrAsk(null);
    setBusy(true);
    setError(null);
    try {
      let payload: File = file;
      let pageOverride: number | undefined;
      if (kind === "pdf" && scope === "page" && pdfRef.current) {
        const blob = await renderPdfPageBlob(pdfRef.current, page);
        payload = new File([blob], `page-${page}.png`, { type: "image/png" });
        pageOverride = page;
      }
      const result = await extractDocument(payload, "json", OCR_OPTIONS);
      const found = regionsFromOcrExtract(result.regions || [], result.image_size, pageOverride);
      if (found.length === 0) {
        setError("Couldn’t find text on this page.");
        return;
      }
      rememberNow(flushedRegions());
      setRegions((prev) => {
        if (scope === "all") {
          return [...prev.filter((region) => region.source !== "ocr"), ...found];
        }
        return [
          ...prev.filter((region) => !(region.page === page && region.source === "ocr")),
          ...found,
        ];
      });
      setNotice("Text on this page.");
      void reloadSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Find text failed.");
    } finally {
      setBusy(false);
    }
  }

  async function persist(blob: Blob, filename: string, handle: EditorWritableHandle | null) {
    if (handle && (await writeFileHandle(handle, blob))) {
      setCanOverwrite(true);
      setNotice("Saved as a stamp on this page.");
      return true;
    }
    downloadBlob(blob, filename);
    setNotice("Downloaded a copy. Saved as a stamp on this page.");
    return false;
  }

  async function onSave(mode: "save" | "save-as") {
    if (!file || !kind) return;
    commitActive();
    setBusy(true);
    setError(null);
    try {
      const blob =
        kind === "pdf" && pdfBytesRef.current
          ? new Blob([(await stampPdfBytes(pdfBytesRef.current, regions)).slice()], {
              type: "application/pdf",
            })
          : await stampImageFile(file, regions);
      let handle = handleRef.current;
      if (mode === "save-as") {
        const picked = await pickSaveHandle(file.name);
        if (picked) {
          handle = picked;
          handleRef.current = picked;
        }
      }
      const wrote = await persist(blob, file.name, handle);
      if (wrote && kind === "pdf") {
        pdfBytesRef.current = await blob.arrayBuffer();
      }
      setRegions((prev) => markRegionsClean(prev));
      resetHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn’t save this file.");
    } finally {
      setBusy(false);
    }
  }

  async function sendRejectedToConvert() {
    if (!rejected) return;
    await saveSessionFile(rejected);
    window.location.assign("/");
  }

  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      takeFiles(e.dataTransfer.files);
    },
  };

  const saveLabel = saveActionLabel(canOverwrite);
  const aiLeft = me?.quota.remaining_ai_month;
  const ocrPages = ocrAsk === "all" ? pageCount : 1;

  return (
    <div className="app-shell app-shell-fixed relative">
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 shrink-0 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <BrandLockup />
          <div className="min-w-0 flex-1">
            {file ? (
              <p className="truncate text-sm font-medium text-[var(--ink)]">
                {file.name}
                <span className="ml-2 font-normal text-[var(--ink-muted)]">
                  {page} / {pageCount}
                </span>
                {dirty ? <span className="ml-2 text-[var(--accent-strong)]">Unsaved</span> : null}
              </p>
            ) : (
              <p className="truncate text-xs text-[var(--ink-muted)]">{PRODUCT.editorLine}</p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <a href="/templates" className={navLink}>
              Designs
            </a>
            <a href="/edit" className="rounded-full px-2.5 py-1.5 text-xs text-[var(--accent-strong)]">
              {PRODUCT.editor}
            </a>
            <a href="/pricing" className={navLink}>
              Pricing
            </a>
            <a href="/docs" className={navLink}>
              API
            </a>
            <AuthBar me={me} status={status} user={displayUser} loginHref="/login?next=/edit" />
            <ThemeToggle className="h-8 w-8" />
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex min-h-0 w-full max-w-[1500px] flex-1 flex-col overflow-hidden px-4 py-3 md:px-6 md:py-4">
        <input
          ref={inputRef}
          type="file"
          accept={EDITOR_ACCEPT}
          className="hidden"
          onChange={(event) => {
            takeFiles(event.target.files);
            event.target.value = "";
          }}
        />

        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onOpen()}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 text-sm font-medium text-[var(--ink)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
          >
            <FolderOpen size={14} aria-hidden />
            Open
          </button>
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => void onSave("save")}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--accent)] px-3 text-sm font-medium text-white disabled:opacity-50 dark:text-[#06281d]"
          >
            <Save size={14} aria-hidden />
            {saveLabel}
          </button>
          <button
            type="button"
            disabled={!file || busy}
            onClick={() => void onSave("save-as")}
            className="inline-flex h-8 items-center rounded-full px-3 text-sm text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] disabled:opacity-50"
          >
            Save as
          </button>
          <button
            type="button"
            title="Undo"
            aria-label="Undo"
            disabled={!canUndo || busy}
            onClick={undo}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] disabled:opacity-50"
          >
            <Undo2 size={14} aria-hidden />
          </button>
          <button
            type="button"
            title="Redo"
            aria-label="Redo"
            disabled={!canRedo || busy}
            onClick={redo}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)] disabled:opacity-50"
          >
            <Redo2 size={14} aria-hidden />
          </button>
          {file && !rejected ? (
            <>
              <EditorInsertBar
                onInsert={(object) => insertDrawn(object)}
                onInsertImage={insertImageFile}
              />
              <EditorStyleBar
                region={selectedRegion}
                pageHeightPx={pagePx}
                onChange={patchSelected}
                onHoldEdit={() => {
                  styleHoldRef.current = true;
                }}
                onReleaseEdit={() => {
                  window.setTimeout(() => {
                    styleHoldRef.current = false;
                  }, 50);
                }}
              />
            </>
          ) : null}
          <a
            href="/"
            className="ml-auto text-xs text-[var(--ink-muted)] underline-offset-2 hover:text-[var(--accent-strong)] hover:underline"
          >
            {PRODUCT.needProduce}
          </a>
        </div>

        {error ? <p className="mb-2 text-sm text-[var(--danger)]">{error}</p> : null}
        {notice && !error ? <p className="mb-2 text-xs text-[var(--ink-muted)]">{notice}</p> : null}
        {busy ? <p className="mb-2 text-xs text-[var(--ink-muted)]">Working…</p> : null}

        {rejected ? (
          <div className="panel mx-auto mt-8 max-w-lg rounded-3xl px-6 py-8 text-center">
            <p className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
              Editor edits text on PDFs and images.
            </p>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">
              Convert office files to Markdown.
            </p>
            <p className="mt-3 truncate text-sm text-[var(--ink)]">{rejected.name}</p>
            <button
              type="button"
              onClick={() => void sendRejectedToConvert()}
              className="mt-5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white dark:text-[#06281d]"
            >
              Convert this file
            </button>
          </div>
        ) : !file && loaded ? (
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--line)] px-6 text-center",
              dragging && "bg-[var(--accent-soft)]",
            )}
            {...dropHandlers}
          >
            <p className="font-[family-name:var(--font-display)] text-3xl tracking-tight">{PRODUCT.editorLine}</p>
            <p className="mt-2 max-w-md text-sm text-[var(--ink-muted)]">
              PDF or image. Fix a typo on a letter, change a date on a scan.
            </p>
            <button
              type="button"
              aria-label="Open a PDF or image"
              onClick={() => void onOpen()}
              className="mt-6 inline-flex items-center gap-2 rounded-2xl border border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3 text-sm font-medium text-[var(--accent-strong)]"
            >
              <Upload size={16} aria-hidden />
              Drop or choose a PDF or image
            </button>
          </div>
        ) : file ? (
          <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
            {kind === "pdf" && pageCount > 1 ? (
              <aside className="hidden w-28 shrink-0 overflow-y-auto md:block" aria-label="Pages">
                {Array.from({ length: pageCount }, (_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      commitActive();
                      setPageIndex(index);
                    }}
                    className={cn(
                      "mb-2 block w-full overflow-hidden rounded-lg border",
                      index === pageIndex ? "border-[var(--accent)]" : "border-[var(--line)]",
                    )}
                  >
                    {thumbs[index] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbs[index]} alt={`Page ${index + 1}`} className="w-full bg-white" />
                    ) : (
                      <span className="block py-6 text-xs text-[var(--ink-muted)]">{index + 1}</span>
                    )}
                  </button>
                ))}
              </aside>
            ) : null}

            <section className="relative min-h-0 min-w-0 flex-1 overflow-auto rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--bg)_80%,black_4%)] p-3">
              {needsFindText ? (
                <div className="mb-3 rounded-2xl border border-[var(--line)] bg-[var(--bg)] px-4 py-3 text-sm">
                  <p>This page has no selectable text. Find text uses AI pages (this page = 1).</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => requestFindText("page")}
                      className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white dark:text-[#06281d]"
                    >
                      Find text on this page
                    </button>
                    {kind === "pdf" && pageCount > 1 ? (
                      <button
                        type="button"
                        onClick={() => requestFindText("all")}
                        className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs"
                      >
                        Find text on all pages
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : selectable ? (
                <p className="mb-2 text-xs text-[var(--ink-muted)]">Text on this page.</p>
              ) : null}

              <div ref={viewportRef} className="flex justify-center">
                <div className="relative inline-block max-w-full">
                  {kind === "pdf" ? (
                    <canvas ref={canvasRef} className="block max-w-full bg-white shadow-[var(--shadow)]" />
                  ) : imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={imageUrl}
                      alt={file.name}
                      className="block max-h-full max-w-full bg-white shadow-[var(--shadow)]"
                      onLoad={(event) => setPagePx(event.currentTarget.clientHeight)}
                    />
                  ) : null}
                  <EditorRegionLayer
                    regions={pageRegions}
                    activeId={activeId}
                    selectedId={selectedId}
                    draft={draft}
                    pageHeightPx={pagePx}
                    onStartEdit={startEdit}
                    onDraftChange={(value) => {
                      draftRef.current = value;
                      setDraft(value);
                    }}
                    onCommit={commitActive}
                    onCancel={cancelActive}
                    onDismiss={dismissSelection}
                    onBlurCommit={commitUnlessStyling}
                    onResize={resizeRegion}
                    onGestureStart={() => {
                      if (boxGestureRef.current) return;
                      boxGestureRef.current = true;
                      rememberNow();
                    }}
                    onGestureEnd={() => {
                      boxGestureRef.current = false;
                    }}
                    onDelete={deleteSelected}
                  />
                </div>
              </div>
              {selectedId ? (
                <p className="mt-2 text-center text-[11px] text-[var(--ink-muted)]">
                  Drag to move. Delete to remove. Undo and redo. Drag a handle to resize.
                </p>
              ) : null}
            </section>
          </div>
        ) : null}
      </main>

      {ocrAsk ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[color-mix(in_oklab,var(--ink)_28%,transparent)] p-4"
          onClick={() => setOcrAsk(null)}
        >
          <form
            role="dialog"
            aria-labelledby="ocr-confirm-title"
            className="panel w-full max-w-md rounded-3xl px-6 py-5"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              void runFindText(ocrAsk);
            }}
          >
            <p id="ocr-confirm-title" className="font-[family-name:var(--font-display)] text-2xl tracking-tight">
              Find text uses AI pages
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
              This {ocrAsk === "all" ? "file" : "page"} = {ocrPages} AI page{ocrPages === 1 ? "" : "s"}
              {typeof aiLeft === "number" ? ` · ${aiLeft} remaining this month` : ""}. Digital PDF text is free;
              OCR is not.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOcrAsk(null)} className="rounded-full px-3 py-1.5 text-sm">
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white dark:text-[#06281d]"
              >
                Find text
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {gate && gate !== "ready" ? (
        <PlanPolicyDialog gate={gate} onClose={() => setGate(null)} loginHref="/login?next=/edit" />
      ) : null}
    </div>
  );
}
