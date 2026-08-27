import { describe, expect, it, vi } from "vitest";
import {
  bytesLookLikeText,
  canOfferEditor,
  canUseFilePicker,
  classifyEditorFile,
  downloadBlob,
  isEditorSourceFile,
  isMarkdownDocumentFile,
  isOfficeEditAsMarkdownFile,
  isPageStampFile,
  isSourceOnlyTextFile,
  isTextEditorFile,
  markdownEditName,
  saveActionLabel,
  textMimeForName,
  winAnsiSafe,
  writeFileHandle,
} from "@/lib/editor-files";

describe("editor-files", () => {
  it("classifies PDF, images, text, office, and other", () => {
    expect(classifyEditorFile({ name: "a.PDF", type: "" })).toBe("pdf");
    expect(classifyEditorFile({ name: "x", type: "application/pdf" })).toBe("pdf");
    expect(classifyEditorFile({ name: "scan.png", type: "image/png" })).toBe("image");
    expect(classifyEditorFile({ name: "photo.JPEG" })).toBe("image");
    expect(classifyEditorFile({ name: "notes.md" })).toBe("text");
    expect(classifyEditorFile({ name: "notes.txt" })).toBe("text");
    expect(classifyEditorFile({ name: "table.csv", type: "text/csv" })).toBe("text");
    expect(classifyEditorFile({ name: "data.json" })).toBe("text");
    expect(classifyEditorFile({ name: "app.ts" })).toBe("text");
    expect(classifyEditorFile({ name: "readme.MDX" })).toBe("text");
    expect(classifyEditorFile({ name: "icon.svg" })).toBe("text");
    expect(classifyEditorFile({ name: "letter.docx" })).toBe("office");
    expect(classifyEditorFile({ name: "sheet.xlsx" })).toBe("office");
    expect(classifyEditorFile({ name: "deck.pptx" })).toBe("office");
    expect(classifyEditorFile({ name: "archive.zip" })).toBe("other");
  });

  it("sniffs binary vs text bytes", () => {
    expect(bytesLookLikeText(new TextEncoder().encode('{"ok":true}'))).toBe(true);
    expect(bytesLookLikeText(new Uint8Array([0, 1, 2, 3, 4]))).toBe(false);
  });

  it("offers the right editor paths per kind", () => {
    expect(isEditorSourceFile({ name: "a.pdf" })).toBe(true);
    expect(isEditorSourceFile({ name: "a.png" })).toBe(true);
    expect(isEditorSourceFile({ name: "a.md" })).toBe(true);
    expect(isEditorSourceFile({ name: "a.json" })).toBe(true);
    expect(isEditorSourceFile({ name: "a.docx" })).toBe(false);
    expect(isPageStampFile({ name: "a.pdf" })).toBe(true);
    expect(isTextEditorFile({ name: "a.md" })).toBe(true);
    expect(isMarkdownDocumentFile({ name: "a.md" })).toBe(true);
    expect(isMarkdownDocumentFile({ name: "a.json" })).toBe(false);
    expect(isSourceOnlyTextFile({ name: "a.csv" })).toBe(true);
    expect(isSourceOnlyTextFile({ name: "a.json" })).toBe(false);
    expect(isOfficeEditAsMarkdownFile({ name: "a.docx" })).toBe(true);
    expect(canOfferEditor({ name: "a.docx" })).toBe(true);
    expect(canOfferEditor({ name: "a.zip" })).toBe(false);
    expect(canOfferEditor({ name: "notes.yaml" })).toBe(true);
    expect(markdownEditName("Quarterly.docx")).toBe("Quarterly.md");
    expect(textMimeForName("notes.md")).toBe("text/markdown");
    expect(textMimeForName("data.json")).toBe("application/json");
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
