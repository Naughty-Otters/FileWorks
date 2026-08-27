import { describe, expect, it, vi } from "vitest";

vi.mock("mammoth", () => {
  const convertToHtml = vi.fn(async () => ({
    value: "<h1>From Word</h1><p>Hello body.</p>",
  }));
  return { __esModule: true, default: { convertToHtml }, convertToHtml };
});

import {
  docxFileToEditorMarkdown,
  isServerOfficeEditFile,
  isWordDocxFile,
} from "@/lib/docx-to-editor";

describe("docx-to-editor", () => {
  it("detects Word .docx vs other office packages", () => {
    expect(
      isWordDocxFile({
        name: "letter.docx",
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe(true);
    expect(isWordDocxFile({ name: "legacy.doc" })).toBe(false);
    expect(isWordDocxFile({ name: "sheet.xlsx" })).toBe(false);
    expect(isServerOfficeEditFile({ name: "sheet.xlsx" })).toBe(true);
    expect(isServerOfficeEditFile({ name: "letter.docx" })).toBe(false);
  });

  it("turns a DOCX into a Markdown editor file without a server call", async () => {
    const docx = new File(["pk"], "Quarterly.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const md = await docxFileToEditorMarkdown(docx);
    expect(md.name).toBe("Quarterly.md");
    expect(md.type).toBe("text/markdown");
    const text = await md.text();
    expect(text).toContain("From Word");
    expect(text).toContain("Hello body");
  });
});
