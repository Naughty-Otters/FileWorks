import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./templates";
import { createEmptyDocument } from "./types";
import { documentToHtml } from "./export-document";

describe("template docs are valid for API shape", () => {
  it("builds documents with positive geometry and required fields", () => {
    const docs = [createEmptyDocument(), ...TEMPLATES.map((t) => t.build())];
    for (const doc of docs) {
      expect(doc.version).toBe(2);
      expect(doc.pageSize.w).toBeGreaterThan(0);
      expect(doc.root.kind).toBe("box");
      const walk = (node: (typeof doc.root)) => {
        expect(node.w).toBeGreaterThan(0);
        expect(node.h).toBeGreaterThan(0);
        expect(node.id).toBeTruthy();
        expect(["box", "heading", "paragraph", "image"]).toContain(node.kind);
        if (node.kind !== "box") expect(node.children).toHaveLength(0);
        node.children.forEach(walk);
      };
      walk(doc.root);
      expect(() => documentToHtml(doc)).not.toThrow();
    }
  });
});
