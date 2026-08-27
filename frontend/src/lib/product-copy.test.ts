import { describe, expect, it } from "vitest";
import { PRODUCT, produceActionLabel, targetEmptyTitle } from "@/lib/product-copy";

describe("product-copy", () => {
  it("frames edit and produce in the home line and one-liner", () => {
    expect(PRODUCT.homeLine).toMatch(/Drop a file/i);
    expect(PRODUCT.homeLine).toMatch(/produce a Design/i);
    expect(PRODUCT.homeLine).not.toMatch(/Markdown or/i);
    expect(PRODUCT.makeFromFile).toMatch(/Produce a Design/i);
    expect(PRODUCT.chooseDesign).toMatch(/Choose a Design/i);
    expect(PRODUCT.editorLine).toMatch(/Open a PDF, image, text, or Word/i);
    expect(PRODUCT.editDocumentHint).toMatch(/no convert/i);
    expect(PRODUCT.editWordHint).toMatch(/no server convert/i);
    expect(PRODUCT.editAsMarkdown).toMatch(/Convert & edit/i);
    expect(PRODUCT.editAsMarkdownHint).toMatch(/Excel|PowerPoint/i);
    expect(PRODUCT.editor).toBe("Editor");
    expect(PRODUCT.oneLiner.toLowerCase()).toContain("design");
    expect(PRODUCT.produceFromFile).toMatch(/Produce from file/i);
  });

  it("names the default Design in the empty target headline", () => {
    expect(targetEmptyTitle(null)).toBe(`You’ll get ${PRODUCT.defaultDesignName}`);
    expect(targetEmptyTitle("Client invoice")).toBe("You’ll get Client invoice");
  });

  it("builds Convert vs Fill action labels", () => {
    expect(produceActionLabel({ intentName: null })).toBe("Convert");
    expect(produceActionLabel({ intentName: null, useAi: true })).toBe("AI Convert");
    expect(produceActionLabel({ intentName: "Client invoice" })).toBe("Fill Client invoice");
    expect(produceActionLabel({ intentName: "Client invoice", useAi: true })).toBe(
      "AI Fill Client invoice",
    );
  });
});
