import { describe, expect, it } from "vitest";
import { TEMPLATES } from "./templates";
import { expandSampleDocument, isStaticTemplate } from "./templating";

describe("built-in templates", () => {
  it("builds every starter as DesignDocument v2", () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(7);
    for (const t of TEMPLATES) {
      const doc = t.build();
      expect(doc.version).toBe(2);
      expect(doc.root.id).toBe("root");
      const expanded = expandSampleDocument(doc);
      expect(expanded.root).toBeTruthy();
      expect(typeof isStaticTemplate(doc)).toBe("boolean");
    }
  });
});
