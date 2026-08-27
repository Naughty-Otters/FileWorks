import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { paintImageStamps, stampPdfBytes, canvasFont } from "@/lib/editor-save";
import type { EditorRegion } from "@/lib/editor-regions";

async function samplePdf(): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 600]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Hello", { x: 40, y: 500, size: 12, font });
  const bytes = await doc.save();
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

const font = {
  kind: "helvetica" as const,
  css: "Helvetica, Arial, sans-serif",
  bold: false,
  italic: false,
  nh: 0.03,
  color: { r: 0, g: 0, b: 0 },
};

const region: EditorRegion = {
  id: "1",
  page: 1,
  text: "Hi",
  original: "Hello",
  box: { x: 0.1, y: 0.1, w: 0.3, h: 0.05 },
  originalBox: { x: 0.1, y: 0.1, w: 0.3, h: 0.05 },
  font,
  originalFont: { ...font },
  source: "pdf",
};

describe("editor-save", () => {
  it("stamps dirty PDF runs and still opens", async () => {
    const bytes = await stampPdfBytes(await samplePdf(), [region]);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(1);
  });

  it("skips clean regions", async () => {
    const source = await samplePdf();
    const bytes = await stampPdfBytes(source, [{ ...region, text: "Hello", original: "Hello" }]);
    expect(bytes.byteLength).toBeGreaterThan(100);
  });

  it("paints image stamps into a 2d context", () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      font: "",
      textBaseline: "",
      fillRect: () => {
        calls.push("rect");
      },
      fillText: () => {
        calls.push("text");
      },
    } as unknown as CanvasRenderingContext2D;
    paintImageStamps(ctx, [region], 200, 100, 1);
    expect(calls).toEqual(["rect", "text"]);
    paintImageStamps(ctx, [region], 200, 100, 2);
    expect(calls).toHaveLength(2);
  });

  it("stamps a style-only edit", () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      font: "",
      textBaseline: "",
      fillRect: () => {
        calls.push("rect");
      },
      fillText: () => {
        calls.push("text");
      },
    } as unknown as CanvasRenderingContext2D;
    paintImageStamps(
      ctx,
      [{ ...region, text: "Hello", original: "Hello", font: { ...font, bold: true } }],
      200,
      100,
      1,
    );
    expect(calls).toEqual(["rect", "text"]);
    expect(ctx.fillStyle).toBe("rgb(0 0 0)");
  });

  it("skips the fill when it is transparent and honors alignment", () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      font: "",
      textBaseline: "",
      textAlign: "left",
      fillRect: () => {
        calls.push("rect");
      },
      fillText: () => {
        calls.push("text");
      },
    } as unknown as CanvasRenderingContext2D;
    paintImageStamps(
      ctx,
      [
        {
          ...region,
          text: "Hello",
          original: "Hello",
          fill: { kind: "none" },
          originalFill: { kind: "color", color: { r: 1, g: 1, b: 1 } },
          align: "center",
        },
      ],
      200,
      100,
      1,
    );
    expect(calls).toEqual(["text"]);
    expect(ctx.textAlign).toBe("center");
  });

  it("builds a CSS canvas font from captured metrics", () => {
    expect(canvasFont({ ...font, bold: true, italic: true, kind: "times", css: "Times, serif" }, 14)).toBe(
      "italic 700 14px Times, serif",
    );
  });

  it("paints rectangles, ellipses, and lines", () => {
    const calls: string[] = [];
    const ctx = {
      fillStyle: "",
      strokeStyle: "",
      font: "",
      textBaseline: "",
      textAlign: "left",
      lineWidth: 1,
      fillRect: () => calls.push("fillRect"),
      strokeRect: () => calls.push("strokeRect"),
      fillText: () => calls.push("fillText"),
      beginPath: () => calls.push("beginPath"),
      ellipse: () => calls.push("ellipse"),
      moveTo: () => calls.push("moveTo"),
      lineTo: () => calls.push("lineTo"),
      stroke: () => calls.push("stroke"),
      fill: () => calls.push("fill"),
    } as unknown as CanvasRenderingContext2D;
    const drawn = {
      ...region,
      text: "",
      original: "",
      originalBox: { x: 0, y: 0, w: 0, h: 0 },
      source: "draw" as const,
    };
    paintImageStamps(ctx, [{ ...drawn, id: "r", object: "rect", fill: { kind: "color", color: { r: 0.2, g: 0.4, b: 0.8 } } }], 200, 100, 1);
    paintImageStamps(ctx, [{ ...drawn, id: "r2", object: "rect", fill: { kind: "none" } }], 200, 100, 1);
    paintImageStamps(ctx, [{ ...drawn, id: "e", object: "ellipse", fill: { kind: "none" } }], 200, 100, 1);
    paintImageStamps(ctx, [{ ...drawn, id: "e2", object: "ellipse", fill: { kind: "color", color: { r: 1, g: 0, b: 0 } } }], 200, 100, 1);
    paintImageStamps(ctx, [{ ...drawn, id: "l", object: "line", fill: { kind: "none" } }], 200, 100, 1);
    paintImageStamps(ctx, [{ ...drawn, id: "i", object: "image", imageSrc: "data:image/png;base64,xx" }], 200, 100, 1);
    paintImageStamps(ctx, [{ ...region, align: "right" }], 200, 100, 1);
    expect(calls).toContain("fillRect");
    expect(calls).toContain("strokeRect");
    expect(calls).toContain("ellipse");
    expect(calls).toContain("stroke");
    expect(calls).toContain("fill");
    expect(ctx.textAlign).toBe("right");
  });

  it("stamps shapes onto a PDF", async () => {
    const drawn = {
      ...region,
      text: "",
      original: "",
      originalBox: { x: 0, y: 0, w: 0, h: 0 },
      source: "draw" as const,
    };
    const bytes = await stampPdfBytes(await samplePdf(), [
      { ...drawn, id: "r", object: "rect", fill: { kind: "color", color: { r: 0.2, g: 0.4, b: 0.8 } } },
      { ...drawn, id: "e", object: "ellipse", fill: { kind: "none" } },
      { ...drawn, id: "l", object: "line", fill: { kind: "color", color: { r: 0, g: 0, b: 0 } } },
      { ...region, align: "right" },
      { ...region, id: "t", fill: { kind: "none" }, originalFill: { kind: "color", color: { r: 1, g: 1, b: 1 } } },
      { ...region, id: "tm", font: { ...font, kind: "times", italic: true, css: "Times, serif" } },
      { ...region, id: "c", font: { ...font, kind: "courier", bold: true, css: "Courier, monospace" } },
    ]);
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBe(1);
  });
});
