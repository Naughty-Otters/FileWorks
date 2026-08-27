import type { EditorRegion } from "@/lib/editor-regions";

export const HISTORY_LIMIT = 50;

export type EditorHistory = {
  past: EditorRegion[][];
  future: EditorRegion[][];
};

export const EMPTY_HISTORY: EditorHistory = { past: [], future: [] };

export function cloneRegions(regions: EditorRegion[]): EditorRegion[] {
  return structuredClone(regions);
}

export function rememberRegions(history: EditorHistory, current: EditorRegion[]): EditorHistory {
  return {
    past: [...history.past, cloneRegions(current)].slice(-HISTORY_LIMIT),
    future: [],
  };
}

export function undoRegions(
  history: EditorHistory,
  current: EditorRegion[],
): { history: EditorHistory; regions: EditorRegion[] } | null {
  if (history.past.length === 0) return null;
  const past = history.past.slice(0, -1);
  const prev = history.past[history.past.length - 1];
  return {
    regions: prev,
    history: {
      past,
      future: [cloneRegions(current), ...history.future],
    },
  };
}

export function redoRegions(
  history: EditorHistory,
  current: EditorRegion[],
): { history: EditorHistory; regions: EditorRegion[] } | null {
  if (history.future.length === 0) return null;
  const [next, ...future] = history.future;
  return {
    regions: next,
    history: {
      past: [...history.past, cloneRegions(current)],
      future,
    },
  };
}

export function applyDraft(regions: EditorRegion[], activeId: string | null, draft: string): EditorRegion[] {
  if (!activeId) return regions;
  return regions.map((region) => (region.id === activeId ? { ...region, text: draft } : region));
}
