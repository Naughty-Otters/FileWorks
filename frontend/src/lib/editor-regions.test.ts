import { describe, expect, it } from "vitest";
import {
  anyRegionDirty,
  alignedTextX,
  applyEditorFont,
  boxesEqual,
  clampBox,
  cloneFont,
  fontFromBox,
  fontSizePx,
  makeDrawnRegion,
  mapEditorFont,
  markRegionsClean,
  mergeLineRuns,
  multiplyTransform,
  ocrBboxToBox,
  pageHasSelectableText,
  pdfTextItemToRegion,
  regionDirty,
  regionsFromOcrExtract,
  resizeNormBox,
  moveNormBox,
  setFontSizePx,
  shrinkToFitFontSize,
  stampRectPdf,
  stampRectPixels,
  type EditorFont,
  type EditorRegion,
} from "@/lib/editor-regions";

const font: EditorFont = {
  kind: "helvetica",
  css: "Helvetica, Arial, sans-serif",
  bold: false,
  italic: false,
  nh: 0.03,
  color: { r: 0, g: 0, b: 0 },
};

const run = (partial: Partial<EditorRegion> & Pick<EditorRegion, "id" | "text">): EditorRegion => {
  const box = partial.box || { x: 0.1, y: 0.1, w: 0.2, h: 0.04 };
  const nextFont = cloneFont(partial.font || font);
  return {
    page: 1,
    original: partial.original ?? partial.text,
    box,
    originalBox: partial.originalBox || { ...box },
    source: "pdf",
    ...partial,
    font: nextFont,
    originalFont: partial.originalFont ? cloneFont(partial.originalFont) : cloneFont(nextFont),
  };
};

describe("editor-regions", () => {
  it("maps PDF font names onto standard families", () => {
    expect(mapEditorFont("Times-Bold", "Times")).toMatchObject({ kind: "times", bold: true, italic: false });
    expect(mapEditorFont("Courier-Oblique")).toMatchObject({ kind: "courier", italic: true });
    expect(mapEditorFont("Arial-BoldItalic", "sans-serif")).toMatchObject({
      kind: "helvetica",
      bold: true,
      italic: true,
    });
  });

  it("normalizes OCR pixel boxes to 0–1 top-left fractions", () => {
    expect(ocrBboxToBox([100, 50, 300, 90], { width: 1000, height: 500 })).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.08,
    });
    expect(ocrBboxToBox([1, 1, 1, 2], { width: 10, height: 10 })).toBeNull();
  });

  it("maps extract regions and skips empty text", () => {
    const regions = regionsFromOcrExtract(
      [
        { id: "a", page: 2, text: "Hello", bbox: [0, 0, 10, 10] },
        { id: "b", page: 2, text: "  ", bbox: [0, 0, 10, 10] },
      ],
      { width: 100, height: 100 },
      3,
    );
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ page: 3, text: "Hello", source: "ocr" });
    expect(regions[0].font.kind).toBe("helvetica");
    expect(regionsFromOcrExtract([{ text: "Hi", bbox: [0, 0, 1, 1] }], null)).toEqual([]);
  });

  it("converts PDF text items through a top-left viewport", () => {
    const region = pdfTextItemToRegion(
      { str: "Hello", transform: [12, 0, 0, 12, 72, 720], width: 30, fontName: "Times-Roman" },
      { width: 612, height: 792, transform: [1, 0, 0, -1, 0, 792] },
      { "Times-Roman": { fontFamily: "Times" } },
    );
    expect(region).not.toBeNull();
    expect(region!.font.kind).toBe("times");
    expect(region!.font.nh).toBeCloseTo(12 / 792);
    expect(region!.font.color).toEqual({ r: 0, g: 0, b: 0 });
    expect(region!.box.x).toBeLessThan(72 / 612);
    expect(region!.box.h).toBeGreaterThan(12 / 792);
    expect(
      pdfTextItemToRegion(
        { str: "   ", transform: [12, 0, 0, 12, 0, 0], width: 1 },
        { width: 1, height: 1, transform: [1, 0, 0, 1, 0, 0] },
      ),
    ).toBeNull();
  });

  it("multiplies affine transforms like PDF.js", () => {
    expect(multiplyTransform([1, 0, 0, -1, 0, 792], [12, 0, 0, 12, 72, 720])).toEqual([12, 0, 0, -12, 72, 72]);
  });

  it("merges adjacent runs on the same line", () => {
    const merged = mergeLineRuns([
      run({ id: "1", text: "Hello", box: { x: 0.1, y: 0.2, w: 0.1, h: 0.03 } }),
      run({ id: "2", text: "world", box: { x: 0.205, y: 0.2, w: 0.1, h: 0.03 } }),
      run({ id: "3", text: "Next", box: { x: 0.1, y: 0.5, w: 0.1, h: 0.03 } }),
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].text).toBe("Hello world");
    expect(merged[1].text).toBe("Next");
  });

  it("shrinks font to the original box but prefers captured size", () => {
    expect(shrinkToFitFontSize("", 100, 20)).toBeCloseTo(16.4);
    expect(shrinkToFitFontSize("HELLO WORLD!!", 40, 40)).toBeLessThan(12);
    expect(shrinkToFitFontSize("Hi", 400, 20, { preferred: 10 })).toBeCloseTo(10);
  });

  it("maps stamp rectangles into PDF and pixel space", () => {
    const box = { x: 0.1, y: 0.2, w: 0.25, h: 0.05 };
    expect(stampRectPdf(box, 400, 800)).toEqual({ x: 40, y: 600, w: 100, h: 40 });
    expect(stampRectPixels(box, 400, 800)).toEqual({ x: 40, y: 160, w: 100, h: 40 });
  });

  it("tracks dirty regions including resized boxes", () => {
    const regions = [
      run({ id: "1", text: "Hi", original: "Hi", source: "pdf", page: 1 }),
      run({ id: "2", text: "Bye", original: "Hi", source: "ocr", page: 2 }),
    ];
    expect(regionDirty(regions[0])).toBe(false);
    expect(anyRegionDirty(regions)).toBe(true);
    expect(pageHasSelectableText(regions, 1)).toBe(true);
    expect(pageHasSelectableText(regions, 2)).toBe(false);
    expect(markRegionsClean(regions)[1].original).toBe("Bye");
    const moved = { ...regions[0], box: { ...regions[0].box, w: 0.5 } };
    expect(regionDirty(moved)).toBe(true);
    expect(boxesEqual(moved.box, moved.originalBox)).toBe(false);
  });

  it("marks font style edits dirty", () => {
    const region = run({ id: "1", text: "Hi" });
    expect(regionDirty(region)).toBe(false);
    const bold = { ...region, font: applyEditorFont(region.font, { bold: true }) };
    expect(regionDirty(bold)).toBe(true);
    expect(markRegionsClean([bold])[0].originalFont.bold).toBe(true);
    expect(fontSizePx(region.font, 800)).toBe(24);
    expect(setFontSizePx(region.font, 800, 12).nh).toBeCloseTo(12 / 800);
  });

  it("clamps boxes onto the page", () => {
    expect(clampBox({ x: -0.2, y: 0.99, w: 0.5, h: 0.5 })).toEqual({
      x: 0,
      y: 0.99,
      w: 0.5,
      h: 0.01,
    });
  });

  it("resizes from a handle and keeps a minimum size", () => {
    const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.1 };
    expect(resizeNormBox(box, "se", 0.05, 0.05)).toMatchObject({ w: 0.25, h: 0.15 });
    expect(resizeNormBox(box, "nw", -0.05, -0.05).x).toBeCloseTo(0.15);
    const tiny = resizeNormBox(box, "e", -1, 0);
    expect(tiny.w).toBeGreaterThanOrEqual(0.008);
    expect(moveNormBox(box, 0.1, -0.05)).toMatchObject({ x: 0.3, y: 0.15, w: 0.2, h: 0.1 });
    expect(moveNormBox(box, -1, 0).x).toBe(0);
    expect(moveNormBox(box, 1, 1).x).toBeCloseTo(0.8);
  });

  it("derives a default font from an OCR box", () => {
    expect(fontFromBox({ x: 0, y: 0, w: 0.2, h: 0.1 }).nh).toBeCloseTo(0.082);
    expect(fontFromBox({ x: 0, y: 0, w: 0.2, h: 0.1 }).color).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("marks fill, alignment, and inserted objects dirty", () => {
    const region = run({ id: "1", text: "Hi" });
    expect(regionDirty({ ...region, align: "center" })).toBe(true);
    expect(regionDirty({ ...region, fill: { kind: "none" } })).toBe(true);
    const drawn = makeDrawnRegion({ page: 1, object: "rect", existing: [] });
    expect(drawn.source).toBe("draw");
    expect(regionDirty(drawn)).toBe(true);
    expect(alignedTextX("center", 10, 100, 20)).toBe(50);
    expect(alignedTextX("right", 10, 100, 20)).toBe(89);
  });
});
