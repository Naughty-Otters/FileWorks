import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./templates";
import { expandSampleDocument, extractUsedVariableNames, isStaticTemplate } from "./templating";
import { documentToHtml } from "./export-document";

/** Every non-root node must sit fully inside its parent's content box. */
function assertNoOverflow(
  node: {
    id: string;
    label: string;
    x: number;
    y: number;
    w: number;
    h: number;
    layout: { padding: number } | null;
    children: Array<{
      id: string;
      label: string;
      x: number;
      y: number;
      w: number;
      h: number;
      layout: { padding: number } | null;
      children: typeof node.children;
    }>;
  },
  isRoot = false,
) {
  const pad = node.layout?.padding ?? 0;
  const innerW = node.w - pad * 2;
  const innerH = isRoot ? Number.POSITIVE_INFINITY : node.h - pad * 2;
  for (const child of node.children) {
    const where = `${node.label || node.id} → ${child.label || child.id}`;
    expect(child.x, `${where} x`).toBeGreaterThanOrEqual(isRoot && !node.layout ? 0 : pad - 0.5);
    expect(child.y, `${where} y`).toBeGreaterThanOrEqual(isRoot && !node.layout ? 0 : pad - 0.5);
    expect(child.x + child.w, `${where} right edge`).toBeLessThanOrEqual(
      (isRoot && !node.layout ? node.w : pad + innerW) + 0.5,
    );
    if (!isRoot || node.layout) {
      expect(child.y + child.h, `${where} bottom edge (parent h=${node.h})`).toBeLessThanOrEqual(
        pad + innerH + 0.5,
      );
    }
    assertNoOverflow(child, false);
  }
}

describe("built-in templates", () => {
  it("builds every starter as DesignDocument v2 with an auto-arranged page", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(16);
    for (const t of TEMPLATES) {
      const doc = t.build();
      expect(doc.version).toBe(2);
      expect(doc.root.id).toBe("root");
      expect(doc.root.layout, `${t.id} page should auto-arrange`).not.toBeNull();
      expect(doc.root.layout?.direction).toBe("column");
      expect(doc.root.layout?.justify).toBe("start");
      assertNoOverflow(doc.root, true);
      const expanded = expandSampleDocument(doc);
      assertNoOverflow(expanded.root, true);
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
      const lists = doc.variables.filter((variable) => variable.type === "list");
      for (const variable of lists) {
        expect(variable.name, `${t.id} list should be named for the template`).toContain(t.id);
        expect(variable.label.length, `${t.id}.${variable.name} needs an explaining label`).toBeGreaterThan(20);
        for (const field of variable.itemSchema || []) {
          expect(field.label.length, `${t.id}.${variable.name}.${field.name} needs a label`).toBeGreaterThan(3);
        }
      }
      for (const variable of doc.variables) {
        if (variable.type === "list" || variable.type === "object") continue;
        const sample = variable.sampleValue.trim();
        if (!sample) continue;
        // Samples may be multi-line; assert the first line appears after expand.
        // HTML escapes & < > so compare against the escaped form.
        const firstLine = sample
          .split("\n")[0]
          .trim()
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        if (firstLine.length > 3) {
          expect(html, `${t.id}: sample for ${variable.name} should render`).toContain(firstLine);
        }
      }
    }
  });
});
