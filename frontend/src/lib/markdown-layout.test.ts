import { describe, expect, it } from "vitest";
import { expandMarkdownLayoutDirectives } from "@/lib/markdown-layout";
import { renderMarkdownToHtml } from "@/lib/markdown-to-html";

describe("markdown layout directives", () => {
  it("expands flex containers to HTML", () => {
    const md = [
      ":::flex gap=12 justify=between",
      ":::item",
      "Left",
      ":::",
      ":::item",
      "Right",
      ":::",
      ":::",
    ].join("\n");
    const out = expandMarkdownLayoutDirectives(md);
    expect(out).toContain('class="md-layout-flex"');
    expect(out).toContain('class="md-layout-item"');
    expect(out).toContain("Left");
    expect(out).toContain("Right");
  });

  it("renders layout directives through the markdown pipeline", async () => {
    const html = await renderMarkdownToHtml(
      [":::grid cols=2 gap=8", ":::item", "**A**", ":::", ":::item", "B", ":::", ":::"].join(
        "\n",
      ),
    );
    expect(html).toContain("md-layout-grid");
    expect(html).toContain("<strong>A</strong>");
  });
});
