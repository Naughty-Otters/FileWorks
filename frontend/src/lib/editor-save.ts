import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { winAnsiSafe } from "@/lib/editor-files";
import {
  alignedTextX,
  fillCss,
  fontColorCss,
  inkOf,
  regionAlign,
  regionDirty,
  regionFill,
  regionObject,
  shrinkToFitFontSize,
  stampRectPdf,
  stampRectPixels,
  type EditorFill,
  type EditorFont,
  type EditorRegion,
} from "@/lib/editor-regions";

function standardFontId(font: EditorFont) {
  const { kind, bold, italic } = font;
  if (kind === "times") {
    if (bold && italic) return StandardFonts.TimesRomanBoldItalic;
    if (bold) return StandardFonts.TimesRomanBold;
    if (italic) return StandardFonts.TimesRomanItalic;
    return StandardFonts.TimesRoman;
  }
  if (kind === "courier") {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
}

export function canvasFont(font: EditorFont, sizePx: number): string {
  const style = font.italic ? "italic" : "normal";
  const weight = font.bold ? "700" : "400";
  return `${style} ${weight} ${sizePx}px ${font.css}`;
}

function pdfRgb(color: { r: number; g: number; b: number }) {
  return rgb(color.r, color.g, color.b);
}

function fillPdfColor(fill: EditorFill) {
  return fill.kind === "color" ? pdfRgb(fill.color) : undefined;
}

function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return { mime: match[1], bytes };
}

async function embedRegionImage(pdf: PDFDocument, dataUrl: string) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  if (parsed.mime.includes("png")) return pdf.embedPng(parsed.bytes);
  if (parsed.mime.includes("jpeg") || parsed.mime.includes("jpg")) return pdf.embedJpg(parsed.bytes);
  return pdf.embedPng(parsed.bytes);
}

function paintFillPdf(
  page: PDFPage,
  rect: { x: number; y: number; w: number; h: number },
  fill: EditorFill,
  object: ReturnType<typeof regionObject>,
) {
  const color = fillPdfColor(fill);
  if (object === "ellipse") {
    page.drawEllipse({
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
      xScale: Math.max(1, rect.w / 2),
      yScale: Math.max(1, rect.h / 2),
      color,
      borderColor: color ? undefined : rgb(0.12, 0.32, 0.72),
      borderWidth: color ? 0 : 1.5,
    });
    return;
  }
  if (object === "line") {
    const ink = color || rgb(0.12, 0.32, 0.72);
    page.drawLine({
      start: { x: rect.x, y: rect.y + rect.h / 2 },
      end: { x: rect.x + rect.w, y: rect.y + rect.h / 2 },
      thickness: Math.max(1, rect.h),
      color: ink,
    });
    return;
  }
  if (!color && object !== "rect") return;
  if (color) {
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: Math.max(1, rect.w),
      height: Math.max(1, rect.h),
      color,
      borderColor: object === "rect" && !color ? rgb(0.12, 0.32, 0.72) : undefined,
      borderWidth: 0,
    });
  } else if (object === "rect") {
    page.drawRectangle({
      x: rect.x,
      y: rect.y,
      width: Math.max(1, rect.w),
      height: Math.max(1, rect.h),
      borderColor: rgb(0.12, 0.32, 0.72),
      borderWidth: 1.5,
    });
  }
}

export async function stampPdfBytes(
  source: ArrayBuffer,
  regions: EditorRegion[],
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source, { ignoreEncryption: true });
  const embedded = new Map<string, PDFFont>();
  const pages = pdf.getPages();
  for (const region of regions.filter(regionDirty)) {
    const page = pages[region.page - 1];
    if (!page) continue;
    const { width, height } = page.getSize();
    const rect = stampRectPdf(region.box, width, height);
    const object = regionObject(region);
    const fill = regionFill(region);
    if (object === "image") {
      if (!region.imageSrc) continue;
      const image = await embedRegionImage(pdf, region.imageSrc);
      if (image) page.drawImage(image, { x: rect.x, y: rect.y, width: Math.max(1, rect.w), height: Math.max(1, rect.h) });
      continue;
    }
    if (object !== "text") {
      paintFillPdf(page, rect, fill, object);
      continue;
    }
    if (fill.kind === "color") {
      page.drawRectangle({
        x: rect.x,
        y: rect.y,
        width: Math.max(1, rect.w),
        height: Math.max(1, rect.h),
        color: pdfRgb(fill.color),
      });
    }
    const fontId = standardFontId(region.font);
    let font = embedded.get(fontId);
    if (!font) {
      font = await pdf.embedFont(fontId);
      embedded.set(fontId, font);
    }
    const safe = winAnsiSafe(region.text);
    if (!safe.trim()) continue;
    const preferred = Math.max(6, region.font.nh * height);
    const widthAtPreferred = font.widthOfTextAtSize(safe, preferred);
    const size =
      widthAtPreferred > Math.max(4, rect.w - 2)
        ? shrinkToFitFontSize(safe, rect.w, rect.h, { preferred })
        : Math.min(preferred, Math.max(6, rect.h * 0.9));
    const textWidth = font.widthOfTextAtSize(safe, size);
    page.drawText(safe, {
      x: alignedTextX(regionAlign(region), rect.x, rect.w, textWidth),
      y: rect.y + Math.max(1, (rect.h - size) * 0.22),
      size,
      font,
      color: pdfRgb(inkOf(region.font)),
    });
  }
  return pdf.save();
}

function paintFillCanvas(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  fill: EditorFill,
  object: ReturnType<typeof regionObject>,
  stroke: string,
) {
  if (object === "line") {
    ctx.strokeStyle = fill.kind === "color" ? fillCss(fill) : stroke;
    ctx.lineWidth = Math.max(1, rect.h);
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + rect.h / 2);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h / 2);
    ctx.stroke();
    return;
  }
  if (object === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.max(1, rect.w / 2), Math.max(1, rect.h / 2), 0, 0, Math.PI * 2);
    if (fill.kind === "color") {
      ctx.fillStyle = fillCss(fill);
      ctx.fill();
    } else {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    return;
  }
  if (fill.kind === "color") {
    ctx.fillStyle = fillCss(fill);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  } else if (object === "rect") {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }
}

export function paintImageStamps(
  ctx: CanvasRenderingContext2D,
  regions: EditorRegion[],
  width: number,
  height: number,
  page = 1,
): void {
  for (const region of regions.filter((item) => item.page === page && regionDirty(item))) {
    const object = regionObject(region);
    if (object === "image") continue;
    const rect = stampRectPixels(region.box, width, height);
    const fill = regionFill(region);
    const stroke = fontColorCss(region.font);
    if (object !== "text") {
      paintFillCanvas(ctx, rect, fill, object, stroke);
      continue;
    }
    if (fill.kind === "color") {
      ctx.fillStyle = fillCss(fill);
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }
    const safe = region.text;
    if (!safe.trim()) continue;
    const preferred = Math.max(6, region.font.nh * height);
    const size = shrinkToFitFontSize(safe, rect.w, rect.h, { preferred });
    ctx.fillStyle = fontColorCss(region.font);
    ctx.font = canvasFont(region.font, size);
    ctx.textBaseline = "top";
    ctx.textAlign = regionAlign(region);
    const x =
      regionAlign(region) === "center"
        ? rect.x + rect.w / 2
        : regionAlign(region) === "right"
          ? rect.x + rect.w - 1
          : rect.x + 1;
    ctx.fillText(safe, x, rect.y + Math.max(1, (rect.h - size) * 0.15), Math.max(4, rect.w - 2));
  }
}

export async function stampImageFile(file: File, regions: EditorRegion[]): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadHtmlImage(url);
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not draw this image.");
    ctx.drawImage(image, 0, 0);
    paintImageStamps(ctx, regions, canvas.width, canvas.height, 1);
    for (const region of regions.filter((item) => item.page === 1 && regionDirty(item) && regionObject(item) === "image")) {
      if (!region.imageSrc) continue;
      const stamp = await loadHtmlImage(region.imageSrc);
      const rect = stampRectPixels(region.box, canvas.width, canvas.height);
      ctx.drawImage(stamp, rect.x, rect.y, Math.max(1, rect.w), Math.max(1, rect.h));
    }
    const type = file.type && file.type.startsWith("image/") ? file.type : "image/png";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type));
    if (!blob) throw new Error("Could not save this image.");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read this image."));
    image.src = src;
  });
}
