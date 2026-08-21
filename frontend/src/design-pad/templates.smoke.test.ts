import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./templates";
import { expandSampleDocument, extractUsedVariableNames, isStaticTemplate } from "./templating";
import { documentToHtml } from "./export-document";

describe("built-in templates", () => {
  it("builds every starter as DesignDocument v2", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(8);
    for (const t of TEMPLATES) {
      const doc = t.build();
      expect(doc.version).toBe(2);
      expect(doc.root.id).toBe("root");
      const expanded = expandSampleDocument(doc);
      expect(expanded.root).toBeTruthy();
      expect(() => documentToHtml(doc)).not.toThrow();
    }
  });

  it("makes every starter variable-driven with declared roots", () => {
    for (const t of TEMPLATES) {
      const doc = t.build();
      expect(isStaticTemplate(doc), `${t.id} should be non-static`).toBe(false);
      expect(doc.variables.length, `${t.id} should declare variables`).toBeGreaterThan(0);

      const declared = new Set(doc.variables.map((v) => v.name));
      const aliases = new Set<string>();
      const collectAliases = (node: (typeof doc.root)) => {
        if (node.repeat?.as) aliases.add(node.repeat.as);
        node.children.forEach(collectAliases);
      };
      collectAliases(doc.root);
      const usedRoots = [...extractUsedVariableNames(doc.root)].map((name) => name.split(".", 1)[0]);
      for (const root of usedRoots) {
        if (aliases.has(root)) continue;
        expect(declared.has(root), `${t.id}: undeclared {{ ${root} }}`).toBe(true);
      }

      const expanded = expandSampleDocument(doc);
      const html = documentToHtml(expanded);
      expect(html).not.toMatch(/\{\{\s*[a-zA-Z_]/);
      for (const variable of doc.variables) {
        if (variable.type === "list" || variable.type === "object") continue;
        const sample = variable.sampleValue.trim();
        if (!sample) continue;
        // Samples may be multi-line; assert the first line appears after expand.
        const firstLine = sample.split("\n")[0].trim();
        if (firstLine.length > 3) {
          expect(html, `${t.id}: sample for ${variable.name} should render`).toContain(firstLine);
        }
      }
    }
  });
});
