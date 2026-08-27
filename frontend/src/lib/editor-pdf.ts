import {
  cloneFont,
  mergeLineRuns,
  pdfTextItemToRegion,
  type EditorRegion,
  type PdfTextItem,
} from "@/lib/editor-regions";

type PdfjsModule = typeof import("pdfjs-dist");

export type OpenedPdf = {
  pageCount: number;
  getPage: (pageNumber: number) => Promise<PdfjsPage>;
  destroy: () => void;
};

type PdfjsPage = {
  getViewport: (params: { scale: number }) => {
    width: number;
    height: number;
    transform: number[];
  };
  getTextContent: () => Promise<{
    items: Array<PdfTextItem | { type?: string }>;
    styles?: Record<string, { fontFamily?: string }>;
  }>;
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    canvas: HTMLCanvasElement;
    viewport: { width: number; height: number };
  }) => {
    promise: Promise<void>;
  };
};

type PdfjsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfjsPage>;
  cleanup?: (keepLoadedFonts?: boolean) => Promise<unknown>;
  loadingTask?: { destroy?: () => Promise<void> };
};

let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((mod) => {
      // Public URL (copied at postinstall). Avoid `new URL(..., import.meta.url)` —
      // Next modulepreloads that worker on /edit and Chrome warns it is unused.
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsPromise;
}

/** pdf.js 6: PDFDocumentProxy has cleanup(); the loading task has destroy(). */
export function teardownPdfjsDocument(doc: {
  cleanup?: () => unknown;
  destroy?: () => unknown;
  loadingTask?: { destroy?: () => unknown };
}): void {
  try {
    if (typeof doc.cleanup === "function") void doc.cleanup();
  } catch {
    // already torn down
  }
  try {
    if (typeof doc.loadingTask?.destroy === "function") {
      void doc.loadingTask.destroy();
      return;
    }
    if (typeof doc.destroy === "function") void doc.destroy();
  } catch {
    // already torn down
  }
}

export async function openPdfDocument(data: ArrayBuffer): Promise<OpenedPdf> {
  const pdfjs = await loadPdfjs();
  // pdf.js transfers TypedArrays to the worker; copy so callers can still save.
  const copy = new Uint8Array(data.slice(0));
  const task = pdfjs.getDocument({
    data: copy,
    verbosity: 0,
    useWasm: false,
  });
  const doc = (await task.promise) as unknown as PdfjsDocument;
  return {
    pageCount: doc.numPages,
    getPage: (pageNumber) => doc.getPage(pageNumber),
    destroy: () => teardownPdfjsDocument(doc),
  };
}

export async function extractPdfRegions(doc: OpenedPdf): Promise<EditorRegion[]> {
  const collected: EditorRegion[] = [];
  for (let pageNumber = 1; pageNumber <= doc.pageCount; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const styles = content.styles || {};
    content.items.forEach((raw, index) => {
      if (!("str" in raw) || typeof raw.str !== "string") return;
      const region = pdfTextItemToRegion(
        {
          str: raw.str,
          transform: raw.transform,
          width: raw.width,
          fontName: "fontName" in raw ? String(raw.fontName || "") : "",
        },
        viewport,
        styles,
        pageNumber,
        index,
      );
      if (region) collected.push(region);
    });
  }
  return mergeLineRuns(collected.filter((region) => region.text.trim())).map((region) => ({
    ...region,
    originalBox: { ...region.box },
    originalFont: cloneFont(region.font),
  }));
}

export function isRenderCancelled(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: string }).name) : "";
  const message = "message" in err ? String((err as { message?: string }).message) : "";
  return name === "RenderingCancelledException" || /render(ing)? cancel/i.test(message);
}

let renderLock: Promise<unknown> = Promise.resolve();

function withPdfRender<T>(work: () => Promise<T>): Promise<T> {
  const next = renderLock.then(work, work);
  renderLock = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export async function renderPdfPage(
  doc: OpenedPdf,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  widthPx: number,
): Promise<{ width: number; height: number }> {
  return withPdfRender(async () => {
    const page = await doc.getPage(pageNumber);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.max(0.25, widthPx / unscaled.width);
    const viewport = page.getViewport({ scale });
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not draw this page.");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    try {
      await page.render({ canvasContext: context, canvas, viewport }).promise;
    } catch (err) {
      if (isRenderCancelled(err)) {
        return { width: canvas.width, height: canvas.height };
      }
      throw err;
    }
    return { width: canvas.width, height: canvas.height };
  });
}

export async function renderPdfPageBlob(doc: OpenedPdf, pageNumber: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  await renderPdfPage(doc, pageNumber, canvas, 1200);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not capture this page.");
  return blob;
}

export async function renderPdfThumbs(doc: OpenedPdf, maxPages = 40): Promise<string[]> {
  const urls: string[] = [];
  const limit = Math.min(doc.pageCount, maxPages);
  for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
    const canvas = document.createElement("canvas");
    await renderPdfPage(doc, pageNumber, canvas, 120);
    urls.push(canvas.toDataURL("image/png"));
  }
  return urls;
}

export function isPasswordPdfError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String(err.name) : "";
  return name === "PasswordException" || name === "PasswordRequiredException";
}
