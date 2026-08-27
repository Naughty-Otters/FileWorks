export type EditorFileKind = "pdf" | "image" | "text" | "office" | "other";

/** Common non-binary text / source extensions TipTap or Source can open. */
export const TEXT_FILE_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".mdx",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".ndjson",
  ".xml",
  ".html",
  ".htm",
  ".xhtml",
  ".svg",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".env",
  ".log",
  ".text",
  ".tex",
  ".bib",
  ".rst",
  ".adoc",
  ".org",
  ".css",
  ".scss",
  ".less",
  ".sass",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".kts",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".graphql",
  ".gql",
  ".vue",
  ".svelte",
  ".dockerfile",
  ".makefile",
  ".cmake",
  ".gradle",
  ".properties",
  ".gitignore",
  ".editorconfig",
  ".npmrc",
  ".patch",
  ".diff",
] as const;

const TEXT_EXT_RE = new RegExp(
  `\\.(${TEXT_FILE_EXTENSIONS.map((ext) => ext.slice(1).replace(/\./g, "\\.")).join("|")})$`,
  "i",
);

export const EDITOR_ACCEPT = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/bmp",
  "image/tiff",
  "text/*",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-yaml",
  "application/yaml",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ...TEXT_FILE_EXTENSIONS,
].join(",");

function isTextMime(type: string): boolean {
  if (!type) return false;
  if (type.startsWith("text/")) return true;
  if (type === "application/json" || type.endsWith("+json")) return true;
  if (type === "application/xml" || type.endsWith("+xml")) return true;
  if (
    type === "application/javascript" ||
    type === "application/typescript" ||
    type === "application/x-javascript" ||
    type === "application/ecmascript"
  ) {
    return true;
  }
  if (type === "application/x-yaml" || type === "application/yaml") return true;
  if (type === "application/sql") return true;
  return false;
}

export function classifyEditorFile(file: { name: string; type?: string }): EditorFileKind {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  // SVG is XML text — prefer the document editor over the page-stamp image path.
  if (name.endsWith(".svg") || type === "image/svg+xml") return "text";
  if (
    type.startsWith("image/") ||
    /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(name)
  ) {
    return "image";
  }
  if (isTextMime(type) || TEXT_EXT_RE.test(name)) {
    return "text";
  }
  // Office binaries (and RTF) stay on Convert & edit — not TipTap-native.
  if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|epub)$/i.test(name)) return "office";
  return "other";
}

/**
 * Heuristic: reject NULs and a high ratio of non-text control bytes.
 * Used when the extension is unknown so we can still try TipTap/Source.
 */
export function bytesLookLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  let suspicious = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    if (b === 0) return false;
    // Allow tab / LF / CR; count other C0 controls as suspicious.
    if (b < 32 && b !== 9 && b !== 10 && b !== 13) suspicious += 1;
  }
  return suspicious / bytes.length < 0.3;
}

export async function fileLooksLikeText(file: File, sampleBytes = 8192): Promise<boolean> {
  try {
    const buf = await file.slice(0, sampleBytes).arrayBuffer();
    return bytesLookLikeText(new Uint8Array(buf));
  } catch {
    return false;
  }
}

/** Opens /edit directly (page stamp or text document). */
export function isEditorSourceFile(file: { name: string; type?: string }): boolean {
  const kind = classifyEditorFile(file);
  return kind === "pdf" || kind === "image" || kind === "text";
}

/** PDF / image stamp editor. */
export function isPageStampFile(file: { name: string; type?: string }): boolean {
  const kind = classifyEditorFile(file);
  return kind === "pdf" || kind === "image";
}

/** Non-binary text opened in Docs-lite / Source (md, txt, json, code, …). */
export function isTextEditorFile(file: { name: string; type?: string }): boolean {
  return classifyEditorFile(file) === "text";
}

/** Markdown (and MDX) use the rich MD↔HTML TipTap path. */
export function isMarkdownDocumentFile(file: { name: string; type?: string }): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return (
    /\.(md|markdown|mdx)$/i.test(name) ||
    type === "text/markdown" ||
    type === "text/x-markdown"
  );
}

/**
 * CSV/TSV stay Source-only — tabular plain text does not round-trip cleanly
 * through the Docs-lite document schema.
 */
export function isSourceOnlyTextFile(file: { name: string; type?: string }): boolean {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  return /\.(csv|tsv)$/i.test(name) || type === "text/csv" || type === "text/tab-separated-values";
}

/**
 * Word / Excel / PowerPoint packages — edit via convert (except .docx, which
 * opens client-side through Mammoth → Docs-lite; see `docx-to-editor.ts`).
 */
export function isOfficeEditAsMarkdownFile(file: { name: string; type?: string }): boolean {
  return classifyEditorFile(file) === "office";
}

/** Show an Edit path on the home chooser. */
export function canOfferEditor(file: { name: string; type?: string }): boolean {
  return isEditorSourceFile(file) || isOfficeEditAsMarkdownFile(file);
}

export function textMimeForName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "text/csv";
  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".mdx")) {
    return "text/markdown";
  }
  if (lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) {
    return "application/json";
  }
  if (lower.endsWith(".xml") || lower.endsWith(".svg")) return "application/xml";
  if (lower.endsWith(".html") || lower.endsWith(".htm") || lower.endsWith(".xhtml")) {
    return "text/html";
  }
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "application/x-yaml";
  if (lower.endsWith(".css") || lower.endsWith(".scss") || lower.endsWith(".less")) {
    return "text/css";
  }
  if (/\.(js|mjs|cjs|jsx)$/i.test(lower)) return "text/javascript";
  if (/\.(ts|mts|cts|tsx)$/i.test(lower)) return "text/typescript";
  return "text/plain";
}

export function markdownEditName(sourceName: string): string {
  const base = sourceName.replace(/\.[^.]+$/, "") || "document";
  return `${base}.md`;
}

export function saveActionLabel(canOverwrite: boolean): "Save" | "Download copy" {
  return canOverwrite ? "Save" : "Download copy";
}

export function winAnsiSafe(text: string): string {
  return text.replace(/[^\t\n\r\u0020-\u007E]/g, "?");
}

export type EditorWritableHandle = {
  queryPermission?: (descriptor: { mode: "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
  requestPermission?: (descriptor: { mode: "readwrite" }) => Promise<"granted" | "denied" | "prompt">;
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
};

export async function writeFileHandle(
  handle: EditorWritableHandle,
  blob: Blob,
): Promise<boolean> {
  try {
    if (handle.queryPermission) {
      let status = await handle.queryPermission({ mode: "readwrite" });
      if (status !== "granted" && handle.requestPermission) {
        status = await handle.requestPermission({ mode: "readwrite" });
      }
      if (status !== "granted") return false;
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

type PickerWindow = Window & {
  showOpenFilePicker?: (options?: Record<string, unknown>) => Promise<Array<{ getFile: () => Promise<File> } & EditorWritableHandle>>;
  showSaveFilePicker?: (options?: Record<string, unknown>) => Promise<{ createWritable: EditorWritableHandle["createWritable"] } & EditorWritableHandle>;
};

export function canUseFilePicker(): boolean {
  if (typeof window === "undefined") return false;
  return typeof (window as PickerWindow).showOpenFilePicker === "function";
}

const PICKER_TYPES = [
  {
    description: "PDF, image, or text",
    accept: {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
      "image/bmp": [".bmp"],
      "image/tiff": [".tif", ".tiff"],
      "text/*": [
        ".txt",
        ".md",
        ".markdown",
        ".mdx",
        ".csv",
        ".tsv",
        ".html",
        ".htm",
        ".css",
        ".js",
        ".ts",
        ".json",
        ".xml",
        ".yaml",
        ".yml",
        ".log",
        ".svg",
      ],
      "application/json": [".json", ".jsonl"],
      "application/xml": [".xml", ".svg"],
    },
  },
];

export async function pickEditorFile(): Promise<{
  file: File;
  handle: EditorWritableHandle | null;
} | null> {
  const win = window as PickerWindow;
  if (typeof win.showOpenFilePicker !== "function") return null;
  try {
    const [handle] = await win.showOpenFilePicker({
      types: PICKER_TYPES,
      excludeAcceptAllOption: false,
      multiple: false,
    });
    const file = await handle.getFile();
    return { file, handle };
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    return null;
  }
}

export async function pickSaveHandle(suggestedName: string): Promise<EditorWritableHandle | null> {
  const win = window as PickerWindow;
  if (typeof win.showSaveFilePicker !== "function") return null;
  try {
    return await win.showSaveFilePicker({
      suggestedName,
      types: PICKER_TYPES,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    return null;
  }
}
