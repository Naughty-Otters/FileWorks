export type EditorFileKind = "pdf" | "image" | "office" | "other";

export const EDITOR_ACCEPT = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/bmp",
  "image/tiff",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
].join(",");

export function classifyEditorFile(file: { name: string; type?: string }): EditorFileKind {
  const name = file.name.toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (
    type.startsWith("image/") ||
    /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(name)
  ) {
    return "image";
  }
  if (/\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv)$/i.test(name)) return "office";
  return "other";
}

export function isEditorSourceFile(file: { name: string; type?: string }): boolean {
  const kind = classifyEditorFile(file);
  return kind === "pdf" || kind === "image";
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
    description: "PDF or image",
    accept: {
      "application/pdf": [".pdf"],
      "image/png": [".png"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/webp": [".webp"],
      "image/bmp": [".bmp"],
      "image/tiff": [".tif", ".tiff"],
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
