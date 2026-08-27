import { describe, expect, it, vi } from "vitest";
import { isRenderCancelled, teardownPdfjsDocument } from "@/lib/editor-pdf";

describe("teardownPdfjsDocument", () => {
  it("uses cleanup and the loading task, not proxy.destroy", () => {
    const destroy = vi.fn();
    const cleanup = vi.fn();
    const taskDestroy = vi.fn();
    teardownPdfjsDocument({
      destroy,
      cleanup,
      loadingTask: { destroy: taskDestroy },
    });
    expect(cleanup).toHaveBeenCalled();
    expect(taskDestroy).toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
  });

  it("falls back to destroy when cleanup/task are missing", () => {
    const destroy = vi.fn();
    teardownPdfjsDocument({ destroy });
    expect(destroy).toHaveBeenCalled();
  });

  it("swallows teardown errors", () => {
    expect(() =>
      teardownPdfjsDocument({
        cleanup: () => {
          throw new Error("cleanup failed");
        },
        destroy: () => {
          throw new Error("destroy failed");
        },
      }),
    ).not.toThrow();
  });

  it("recognizes a cancelled pdf.js render", () => {
    expect(isRenderCancelled({ name: "RenderingCancelledException" })).toBe(true);
    expect(isRenderCancelled(new Error("Rendering cancelled"))).toBe(true);
    expect(isRenderCancelled(new Error("boom"))).toBe(false);
  });
});
