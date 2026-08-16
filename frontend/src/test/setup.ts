/// <reference types="vitest/globals" />
import "@testing-library/jest-dom/vitest";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return [...this.store.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

Object.defineProperty(window, "localStorage", { value: new MemoryStorage() });
Object.defineProperty(window, "sessionStorage", { value: new MemoryStorage() });

if (!window.URL.createObjectURL) {
  window.URL.createObjectURL = () => "blob:mock";
  window.URL.revokeObjectURL = () => undefined;
}

beforeEach(async () => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  // The session store is module state, so it outlives a single render tree. Import
  // it here rather than at the top: a static import would bind the store to the
  // real @/lib/api before a test file's vi.mock is registered.
  const { resetSessionStore } = await import("@/lib/session");
  resetSessionStore();
});

if (!navigator.clipboard) {
  Object.assign(navigator, { clipboard: { writeText: async () => undefined } });
}
