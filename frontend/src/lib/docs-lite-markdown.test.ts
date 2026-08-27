import { describe, expect, it } from "vitest";
import {
  docsLiteHtmlToMarkdown,
  docsLiteHtmlToPlain,
  docsLitePlainFallbackHtml,
  docsLiteRoundTrip,
  prepareHtmlForTipTap,
} from "@/lib/docs-lite-markdown";

describe("docs-lite-markdown", () => {
  it("round-trips headings, lists, and links", async () => {
    const source = [
      "# Title",
      "",
      "A **bold** and *italic* line.",
      "",
      "- one",
      "- two",
      "",
      "See [FileWorks](https://fileworks.ai).",
    ].join("\n");
    const out = await docsLiteRoundTrip(source);
    expect(out).toContain("# Title");
    expect(out).toMatch(/\*\*bold\*\*/);
    expect(out).toMatch(/\*italic\*/);
    expect(out).toContain("one");
    expect(out).toContain("two");
    expect(out).toContain("https://fileworks.ai");
  });

  it("converts simple TipTap HTML to Markdown", () => {
    const md = docsLiteHtmlToMarkdown(
      "<h2>Hello</h2><p>World with <strong>emphasis</strong>.</p><ul><li><p>item</p></li></ul>",
    );
    expect(md).toContain("## Hello");
    expect(md).toContain("**emphasis**");
    expect(md).toContain("item");
  });

  it("unwraps prose-table-wrap for TipTap", () => {
    const html = prepareHtmlForTipTap(
      '<div class="prose-table-wrap"><table><tr><td>A</td></tr></table></div>',
    );
    expect(html).toContain("<table>");
    expect(html).not.toContain("prose-table-wrap");
  });

  it("builds a plain fallback that keeps the text", () => {
    const html = docsLitePlainFallbackHtml("Line one\n\nLine two");
    expect(html).toContain("Line one");
    expect(html).toContain("Line two");
  });

  it("round-trips plain TipTap HTML without Markdown markers", () => {
    const plain = docsLiteHtmlToPlain('<p>{"a":1}</p><p>line two</p>');
    expect(plain).toContain('{"a":1}');
    expect(plain).toContain("line two");
    expect(plain).not.toMatch(/^#/m);
  });
});
