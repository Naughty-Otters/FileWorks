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

/** Empty layout rect — jsdom lacks real geometry; TipTap/ProseMirror needs these. */
const emptyDomRect = (): DOMRect => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON() {
    return {};
  },
});

const emptyDomRectList = (): DOMRectList =>
  ({
    length: 0,
    item: () => null,
    [Symbol.iterator]: function* () {},
  }) as DOMRectList;

for (const proto of [Element.prototype, Range.prototype]) {
  if (typeof proto.getBoundingClientRect !== "function") {
    proto.getBoundingClientRect = () => emptyDomRect();
  }
  if (typeof proto.getClientRects !== "function") {
    proto.getClientRects = () => emptyDomRectList();
  }
}

// ProseMirror scrollToSelection may call getClientRects on non-Element targets.
const nodeProto = Node.prototype as Node & {
  getClientRects?: () => DOMRectList;
  getBoundingClientRect?: () => DOMRect;
};
if (typeof nodeProto.getClientRects !== "function") {
  nodeProto.getClientRects = () => emptyDomRectList();
}
if (typeof nodeProto.getBoundingClientRect !== "function") {
  nodeProto.getBoundingClientRect = () => emptyDomRect();
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
