import { describe, expect, it, vi } from "vitest";
import {
  canUseFilePicker,
  classifyEditorFile,
  downloadBlob,
  isEditorSourceFile,
  saveActionLabel,
  winAnsiSafe,
  writeFileHandle,
} from "@/lib/editor-files";

describe("editor-files", () => {
  it("classifies PDF, images, office, and other", () => {
    expect(classifyEditorFile({ name: "a.PDF", type: "" })).toBe("pdf");
    expect(classifyEditorFile({ name: "x", type: "application/pdf" })).toBe("pdf");
    expect(classifyEditorFile({ name: "scan.png", type: "image/png" })).toBe("image");
    expect(classifyEditorFile({ name: "photo.JPEG" })).toBe("image");
    expect(classifyEditorFile({ name: "letter.docx" })).toBe("office");
    expect(classifyEditorFile({ name: "sheet.xlsx" })).toBe("office");
    expect(classifyEditorFile({ name: "deck.pptx" })).toBe("office");
    expect(classifyEditorFile({ name: "notes.md" })).toBe("other");
    expect(classifyEditorFile({ name: "notes.txt" })).toBe("other");
  });

  it("treats only PDF and images as editor sources", () => {
    expect(isEditorSourceFile({ name: "a.pdf" })).toBe(true);
    expect(isEditorSourceFile({ name: "a.png" })).toBe(true);
    expect(isEditorSourceFile({ name: "a.docx" })).toBe(false);
  });

  it("labels Save vs Download copy from the file handle", () => {
    expect(saveActionLabel(true)).toBe("Save");
    expect(saveActionLabel(false)).toBe("Download copy");
  });

  it("replaces non-WinAnsi characters for Helvetica stamps", () => {
    expect(winAnsiSafe("Café — 你好")).toBe("Caf? ? ??");
  });

  it("writes through a file handle when permission is granted", async () => {
    const writes: Blob[] = [];
    const ok = await writeFileHandle(
      {
        queryPermission: async () => "granted",
        createWritable: async () => ({
          write: async (data) => {
            writes.push(data);
          },
          close: async () => undefined,
        }),
      },
      new Blob(["hi"]),
    );
    expect(ok).toBe(true);
    expect(writes).toHaveLength(1);
  });

  it("requests permission then fails closed", async () => {
    const denied = await writeFileHandle(
      {
        queryPermission: async () => "prompt",
        requestPermission: async () => "denied",
        createWritable: async () => {
          throw new Error("should not write");
        },
      },
      new Blob(["hi"]),
    );
    expect(denied).toBe(false);
  });

  it("downloads a blob and reports picker support", () => {
    expect(canUseFilePicker()).toBe(false);
    const click = vi.fn();
    const create = vi.spyOn(document, "createElement").mockImplementation(() => {
      return { click, href: "", download: "", remove: vi.fn() } as unknown as HTMLAnchorElement;
    });
    const append = vi.spyOn(document.body, "appendChild").mockImplementation((node) => node);
    downloadBlob(new Blob(["x"]), "a.pdf");
    expect(click).toHaveBeenCalled();
    create.mockRestore();
    append.mockRestore();
  });
});
