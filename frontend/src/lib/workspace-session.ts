import {
  DEFAULT_EXTRACT_OPTIONS,
  type ExtractOptions,
  type ExtractResponse,
} from "@/lib/api";

const PREFS_KEY = "fileworks.workspace.v1";
const FILE_DB = "fileworks";
const FILE_STORE = "session-file";
const FILE_KEY = "current";

export type MarkdownMode = "preview" | "edit";

export type WorkspacePrefs = {
  selectedId: string | null;
  view: "markdown" | "json";
  historyOpen: boolean;
  previewOpen: boolean;
  extractOptions: ExtractOptions;
  markdownMode: MarkdownMode;
  markdownToolbar: boolean;
  markdownDraft: string;
  result: ExtractResponse | null;
};

const DEFAULT_PREFS: WorkspacePrefs = {
  selectedId: null,
  view: "markdown",
  historyOpen: true,
  previewOpen: true,
  extractOptions: DEFAULT_EXTRACT_OPTIONS,
  markdownMode: "preview",
  markdownToolbar: true,
  markdownDraft: "",
  result: null,
};

export function loadWorkspacePrefs(): WorkspacePrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<WorkspacePrefs>;
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      extractOptions: {
        ...DEFAULT_EXTRACT_OPTIONS,
        ...(parsed.extractOptions || {}),
      },
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveWorkspacePrefs(prefs: WorkspacePrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Quota or private mode — ignore.
  }
}

function openFileDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(FILE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        db.createObjectStore(FILE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveSessionFile(file: File | null): Promise<void> {
  if (typeof window === "undefined" || !window.indexedDB) return;
  try {
    const db = await openFileDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, "readwrite");
      const store = tx.objectStore(FILE_STORE);
      if (!file) {
        store.delete(FILE_KEY);
      } else {
        store.put(
          {
            name: file.name,
            type: file.type,
            lastModified: file.lastModified,
            buffer: file,
          },
          FILE_KEY,
        );
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Private mode or quota — ignore.
  }
}

export async function loadSessionFile(): Promise<File | null> {
  if (typeof window === "undefined" || !window.indexedDB) return null;
  try {
    const db = await openFileDb();
    const record = await new Promise<{
      name: string;
      type: string;
      lastModified: number;
      buffer: Blob | File | ArrayBuffer;
    } | null>((resolve, reject) => {
      const tx = db.transaction(FILE_STORE, "readonly");
      const request = tx.objectStore(FILE_STORE).get(FILE_KEY);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    if (!record) return null;
    const blob =
      record.buffer instanceof Blob
        ? record.buffer
        : new Blob([record.buffer], { type: record.type || "application/octet-stream" });
    return new File([blob], record.name || "document", {
      type: record.type || blob.type,
      lastModified: record.lastModified || Date.now(),
    });
  } catch {
    return null;
  }
}
