import { describe, expect, it } from "vitest";
import { createEmptyDocument, createNode, createVariable } from "./types";
import { documentToHtml, documentToMarkdown, effectiveDefault, typeDefaultValue } from "./export-document";

describe("export + defaults", () => {
  it("falls back to type defaults when unset", () => {
    expect(typeDefaultValue("currency")).toBe("$0.00");
    expect(effectiveDefault(createVariable("total", "Total", "currency", ""))).toBe("$0.00");
    expect(effectiveDefault(createVariable("total", "Total", "currency", "$12"))).toBe("$12");
  });

  it("renders html and markdown for a simple doc", () => {
    const doc = createEmptyDocument();
    const heading = createNode("heading");
    heading.label = "Hello {{ name }}";
    doc.root.children.push(heading);
    doc.variables.push(createVariable("name", "Name", "text", "Ada"));
    const html = documentToHtml(doc, "Test");
    expect(html).toContain("Ada");
    expect(html).toContain(`height:${doc.root.h}px`);
    expect(html).not.toContain("height:100%");
    expect(documentToMarkdown(doc)).toContain("Ada");
    expect(documentToHtml(doc, "Test", { embed: true })).toContain("box-shadow:none");
  });

  it("falls back to the variable label when text default is empty", () => {
    expect(effectiveDefault(createVariable("company", "Acme Co.", "text", ""))).toBe("Acme Co.");
  });
});
