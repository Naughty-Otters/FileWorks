import { describe, expect, it } from "vitest";
import { createNode } from "./types";
import { estimateTextHeight, fitTextContent } from "./layout/text-fit";
import { expandSampleDocument } from "./templating";
import { TEMPLATES } from "./templates";

describe("text fit", () => {
  it("grows short paragraph boxes to fit multi-line copy", () => {
    const node = createNode("paragraph");
    node.w = 200;
    node.h = 20;
    node.label = "Line one\nLine two\nLine three";
    node.style.fontSize = 14;
    expect(estimateTextHeight(node)).toBeGreaterThan(20);
    fitTextContent(node);
    expect(node.h).toBeGreaterThanOrEqual(estimateTextHeight(node));
  });

  it("preview expansion leaves every text leaf tall enough for its label", () => {
    for (const t of TEMPLATES) {
      const expanded = expandSampleDocument(t.build());
      const walk = (node: ReturnType<typeof t.build>["root"]) => {
        if (node.kind === "paragraph" || node.kind === "heading") {
          expect(
            node.h,
            `${t.id}:${node.label.slice(0, 24)} h=${node.h}`,
          ).toBeGreaterThanOrEqual(estimateTextHeight(node) - 1);
        }
        node.children.forEach(walk);
      };
      walk(expanded.root);
    }
  });
});
