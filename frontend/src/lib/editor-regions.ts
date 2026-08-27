export type NormBox = { x: number; y: number; w: number; h: number };

export type EditorFontKind = "helvetica" | "times" | "courier";

export type EditorColor = { r: number; g: number; b: number };

export type EditorFont = {
  kind: EditorFontKind;
  css: string;
  bold: boolean;
  italic: boolean;
  /** Size as a fraction of page height. */
  nh: number;
  color: EditorColor;
};

export const FONT_CSS: Record<EditorFontKind, string> = {
  helvetica: "Helvetica, Arial, sans-serif",
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};

export const FONT_KIND_LABELS: Record<EditorFontKind, string> = {
  helvetica: "Helvetica",
  times: "Times",
  courier: "Courier",
};

export const FONT_KINDS: EditorFontKind[] = ["helvetica", "times", "courier"];

export const INK_BLACK: EditorColor = { r: 0, g: 0, b: 0 };
export const INK_WHITE: EditorColor = { r: 1, g: 1, b: 1 };

export type EditorAlign = "left" | "center" | "right";
export type EditorObject = "text" | "image" | "rect" | "ellipse" | "line";
export type EditorFill = { kind: "none" } | { kind: "color"; color: EditorColor };

export const FILL_NONE: EditorFill = { kind: "none" };
export const FILL_WHITE: EditorFill = { kind: "color", color: INK_WHITE };

function rgb8(r: number, g: number, b: number): EditorColor {
  return { r: r / 255, g: g / 255, b: b / 255 };
}

/** Document-style color palette (grays + hues + tints). */
export const EDITOR_PALETTE: { id: string; label: string; color: EditorColor }[] = [
  { id: "black", label: "Black", color: INK_BLACK },
  { id: "gray-80", label: "Dark gray", color: rgb8(67, 67, 67) },
  { id: "gray-60", label: "Gray", color: rgb8(102, 102, 102) },
  { id: "gray-40", label: "Light gray", color: rgb8(153, 153, 153) },
  { id: "gray-20", label: "Silver", color: rgb8(204, 204, 204) },
  { id: "white", label: "White", color: INK_WHITE },
  { id: "red", label: "Red", color: rgb8(204, 0, 0) },
  { id: "orange", label: "Orange", color: rgb8(230, 145, 56) },
  { id: "yellow", label: "Yellow", color: rgb8(241, 194, 50) },
  { id: "green", label: "Green", color: rgb8(106, 168, 79) },
  { id: "cyan", label: "Cyan", color: rgb8(69, 129, 142) },
  { id: "blue", label: "Blue", color: rgb8(61, 133, 198) },
  { id: "purple", label: "Purple", color: rgb8(103, 78, 167) },
  { id: "magenta", label: "Magenta", color: rgb8(166, 77, 121) },
  { id: "red-light", label: "Light red", color: rgb8(234, 153, 153) },
  { id: "orange-light", label: "Light orange", color: rgb8(249, 203, 156) },
  { id: "yellow-light", label: "Light yellow", color: rgb8(255, 229, 153) },
  { id: "green-light", label: "Light green", color: rgb8(182, 215, 168) },
  { id: "cyan-light", label: "Light cyan", color: rgb8(162, 196, 201) },
  { id: "blue-light", label: "Light blue", color: rgb8(164, 194, 244) },
  { id: "purple-light", label: "Light purple", color: rgb8(180, 167, 214) },
  { id: "magenta-light", label: "Light magenta", color: rgb8(213, 166, 189) },
  { id: "red-dark", label: "Dark red", color: rgb8(153, 0, 0) },
  { id: "orange-dark", label: "Dark orange", color: rgb8(180, 95, 6) },
  { id: "yellow-dark", label: "Dark yellow", color: rgb8(191, 144, 0) },
  { id: "green-dark", label: "Dark green", color: rgb8(56, 118, 29) },
  { id: "cyan-dark", label: "Dark cyan", color: rgb8(19, 79, 92) },
  { id: "blue-dark", label: "Dark blue", color: rgb8(17, 85, 204) },
  { id: "purple-dark", label: "Dark purple", color: rgb8(53, 28, 117) },
  { id: "magenta-dark", label: "Dark magenta", color: rgb8(116, 27, 71) },
];

export const EDITOR_ALIGN: EditorAlign[] = ["left", "center", "right"];

export const FONT_SIZE_MIN = 6;
export const FONT_SIZE_MAX = 96;

export function inkOf(font: EditorFont): EditorColor {
  return font.color || INK_BLACK;
}

export function colorCss(color: EditorColor): string {
  const { r, g, b } = color;
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

export function fontColorCss(font: EditorFont): string {
  return colorCss(inkOf(font));
}

export function cloneFont(font: EditorFont): EditorFont {
  return {
    kind: font.kind,
    css: FONT_CSS[font.kind] || font.css,
    bold: font.bold,
    italic: font.italic,
    nh: font.nh,
    color: { ...inkOf(font) },
  };
}

export function colorsEqual(a: EditorColor, b: EditorColor): boolean {
  const round = (n: number) => Math.round(n * 1000);
  return round(a.r) === round(b.r) && round(a.g) === round(b.g) && round(a.b) === round(b.b);
}

export function fontsEqual(a: EditorFont, b: EditorFont): boolean {
  return (
    a.kind === b.kind &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.nh === b.nh &&
    colorsEqual(inkOf(a), inkOf(b))
  );
}

export function cloneFill(fill: EditorFill): EditorFill {
  return fill.kind === "none" ? { kind: "none" } : { kind: "color", color: { ...fill.color } };
}

export function fillsEqual(a: EditorFill, b: EditorFill): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "none" || b.kind === "none") return a.kind === b.kind;
  return colorsEqual(a.color, b.color);
}

export function fillCss(fill: EditorFill): string {
  return fill.kind === "none" ? "transparent" : colorCss(fill.color);
}

export function applyEditorFont(font: EditorFont, patch: Partial<EditorFont>): EditorFont {
  const kind = patch.kind ?? font.kind;
  return {
    kind,
    css: FONT_CSS[kind],
    bold: patch.bold ?? font.bold,
    italic: patch.italic ?? font.italic,
    nh: patch.nh ?? font.nh,
    color: patch.color ? { ...patch.color } : { ...inkOf(font) },
  };
}

export function fontSizePx(font: EditorFont, pageHeightPx: number): number {
  const page = pageHeightPx > 10 ? pageHeightPx : 800;
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(font.nh * page)));
}

export function setFontSizePx(font: EditorFont, pageHeightPx: number, sizePx: number): EditorFont {
  const page = pageHeightPx > 10 ? pageHeightPx : 800;
  const size = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(sizePx)));
  return applyEditorFont(font, { nh: size / page });
}

export function mapEditorFont(fontName: string, fontFamily = ""): Pick<EditorFont, "kind" | "css" | "bold" | "italic"> {
  const blob = `${fontName} ${fontFamily}`;
  const lower = blob.toLowerCase();
  const bold = /bold|black|heavy|semibold|demi/i.test(blob);
  const italic = /italic|oblique/i.test(blob);
  let kind: EditorFontKind = "helvetica";
  if (/courier|mono/i.test(lower)) kind = "courier";
  else if (/(times|georgia|garamond|cambria|palatino)/i.test(lower) || (/\bserif\b/.test(lower) && !/sans/.test(lower))) {
    kind = "times";
  }
  return { kind, css: FONT_CSS[kind], bold, italic };
}

export function fontFromBox(box: NormBox, hint?: Partial<EditorFont>): EditorFont {
  const kind = hint?.kind || "helvetica";
  return {
    kind,
    css: FONT_CSS[kind],
    bold: hint?.bold ?? false,
    italic: hint?.italic ?? false,
    nh: hint?.nh ?? Math.max(0.008, box.h * 0.82),
    color: hint?.color ? { ...hint.color } : { ...INK_BLACK },
  };
}

export type EditorRegion = {
  id: string;
  page: number;
  text: string;
  original: string;
  box: NormBox;
  originalBox: NormBox;
  font: EditorFont;
  originalFont: EditorFont;
  source: "pdf" | "ocr" | "draw";
  object?: EditorObject;
  align?: EditorAlign;
  originalAlign?: EditorAlign;
  fill?: EditorFill;
  originalFill?: EditorFill;
  imageSrc?: string;
};

export function regionObject(region: EditorRegion): EditorObject {
  return region.object || "text";
}

export function regionAlign(region: EditorRegion): EditorAlign {
  return region.align || "left";
}

export function regionFill(region: EditorRegion): EditorFill {
  return region.fill || FILL_WHITE;
}

export function boxesEqual(a: NormBox, b: NormBox): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export function regionDirty(region: EditorRegion): boolean {
  return (
    region.text !== region.original ||
    !boxesEqual(region.box, region.originalBox) ||
    !fontsEqual(region.font, region.originalFont) ||
    regionAlign(region) !== (region.originalAlign ?? "left") ||
    !fillsEqual(regionFill(region), region.originalFill ?? FILL_WHITE)
  );
}

export function anyRegionDirty(regions: EditorRegion[]): boolean {
  return regions.some(regionDirty);
}

export function markRegionsClean(regions: EditorRegion[]): EditorRegion[] {
  return regions.map((region) => ({
    ...region,
    original: region.text,
    originalBox: { ...region.box },
    originalFont: cloneFont(region.font),
    originalAlign: regionAlign(region),
    originalFill: cloneFill(regionFill(region)),
  }));
}

export function clampBox(box: NormBox): NormBox {
  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  const w = Math.min(1 - x, Math.max(0.004, box.w));
  const h = Math.min(1 - y, Math.max(0.004, box.h));
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  return { x: round(x), y: round(y), w: round(w), h: round(h) };
}

export function ocrBboxToBox(
  bbox: number[],
  imageSize: { width: number; height: number },
): NormBox | null {
  if (bbox.length < 4 || !imageSize.width || !imageSize.height) return null;
  const x1 = Number(bbox[0]);
  const y1 = Number(bbox[1]);
  const x2 = Number(bbox[2]);
  const y2 = Number(bbox[3]);
  if (![x1, y1, x2, y2].every(Number.isFinite) || x2 <= x1 || y2 <= y1) return null;
  return clampBox({
    x: x1 / imageSize.width,
    y: y1 / imageSize.height,
    w: (x2 - x1) / imageSize.width,
    h: (y2 - y1) / imageSize.height,
  });
}

export function regionsFromOcrExtract(
  regions: Array<{ id?: string; page?: number; text?: string; bbox: number[] }>,
  imageSize: { width: number; height: number } | null | undefined,
  pageOverride?: number,
): EditorRegion[] {
  if (!imageSize?.width || !imageSize.height) return [];
  const out: EditorRegion[] = [];
  regions.forEach((item, index) => {
    const text = (item.text || "").trim();
    if (!text) return;
    const box = ocrBboxToBox(item.bbox, imageSize);
    if (!box) return;
    const page = pageOverride ?? item.page ?? 1;
    const font = fontFromBox(box);
    out.push({
      id: item.id || `ocr-p${page}-${index}`,
      page,
      text,
      original: text,
      box,
      originalBox: { ...box },
      font,
      originalFont: cloneFont(font),
      source: "ocr",
      object: "text",
      align: "left",
      originalAlign: "left",
      fill: cloneFill(FILL_WHITE),
      originalFill: cloneFill(FILL_WHITE),
    });
  });
  return out;
}

/** Multiply two PDF 2D affine matrices `[a,b,c,d,e,f]`. */
export function multiplyTransform(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  fontName?: string;
};

export type PdfTextStyle = { fontFamily?: string };

export type ViewportInfo = {
  width: number;
  height: number;
  transform: number[];
};

export function pdfTextItemToRegion(
  item: PdfTextItem,
  viewport: ViewportInfo,
  styles: Record<string, PdfTextStyle> = {},
  page = 1,
  index = 0,
): EditorRegion | null {
  const str = (item.str || "").replace(/\s+$/, "");
  if (!str.trim() || item.transform.length < 6 || viewport.transform.length < 6) return null;
  const m = multiplyTransform(viewport.transform, item.transform);
  const fontH = Math.hypot(m[2], m[3]) || Math.hypot(m[0], m[1]);
  if (!fontH || !viewport.width || !viewport.height) return null;
  const itemScale = Math.hypot(item.transform[0], item.transform[1]) || 1;
  const widthPx = item.width > 0 ? item.width * (Math.hypot(m[0], m[1]) / itemScale) : str.length * fontH * 0.5;
  const left = m[4];
  const baseline = m[5];
  const top = baseline - fontH;
  const padY = fontH * 0.12;
  const padX = Math.max(1, fontH * 0.08);
  const box = clampBox({
    x: (left - padX) / viewport.width,
    y: (top - padY) / viewport.height,
    w: Math.max(widthPx + padX * 2, 4) / viewport.width,
    h: Math.max(fontH + padY * 2, 4) / viewport.height,
  });
  const mapped = mapEditorFont(item.fontName || "", styles[item.fontName || ""]?.fontFamily || "");
  const font = { ...mapped, nh: fontH / viewport.height, color: { ...INK_BLACK } };
  return {
    id: `pdf-p${page}-${index}`,
    page,
    text: str,
    original: str,
    box,
    originalBox: { ...box },
    font,
    originalFont: cloneFont(font),
    source: "pdf",
    object: "text",
    align: "left",
    originalAlign: "left",
    fill: cloneFill(FILL_WHITE),
    originalFill: cloneFill(FILL_WHITE),
  };
}

export function mergeLineRuns(regions: EditorRegion[]): EditorRegion[] {
  const grouped = new Map<number, EditorRegion[]>();
  for (const region of regions) {
    const list = grouped.get(region.page) || [];
    list.push(region);
    grouped.set(region.page, list);
  }
  const merged: EditorRegion[] = [];
  for (const [page, list] of grouped) {
    const sorted = [...list].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    let current: EditorRegion | null = null;
    let run = 0;
    const flush = () => {
      if (!current) return;
      merged.push({ ...current, id: `${current.source}-p${page}-${run}` });
      run += 1;
      current = null;
    };
    for (const next of sorted) {
      if (!current) {
        current = { ...next, box: { ...next.box } };
        continue;
      }
      const sameLine = Math.abs(next.box.y - current.box.y) <= Math.max(current.box.h, next.box.h) * 0.4;
      const gap = next.box.x - (current.box.x + current.box.w);
      const close = gap >= -0.004 && gap < Math.max(0.012, current.box.h * 0.8);
      if (sameLine && close && current.source === next.source) {
        const space = gap > 0.003 ? " " : "";
        const right = next.box.x + next.box.w;
        const bottom = Math.max(current.box.y + current.box.h, next.box.y + next.box.h);
        current = {
          ...current,
          text: `${current.text}${space}${next.text}`,
          original: `${current.original}${space}${next.original}`,
          box: {
            x: current.box.x,
            y: Math.min(current.box.y, next.box.y),
            w: right - current.box.x,
            h: bottom - Math.min(current.box.y, next.box.y),
          },
          originalBox: {
            x: current.box.x,
            y: Math.min(current.box.y, next.box.y),
            w: right - current.box.x,
            h: bottom - Math.min(current.box.y, next.box.y),
          },
        };
      } else {
        flush();
        current = { ...next, box: { ...next.box } };
      }
    }
    flush();
  }
  return merged;
}

export function shrinkToFitFontSize(
  text: string,
  widthPx: number,
  heightPx: number,
  opts?: { min?: number; charWidth?: number; preferred?: number },
): number {
  const min = opts?.min ?? 6;
  const charWidth = opts?.charWidth ?? 0.55;
  const maxFromHeight = Math.max(min, heightPx * 0.82);
  const preferred = opts?.preferred ?? maxFromHeight;
  if (!text) return Math.min(preferred, maxFromHeight);
  const maxFromWidth = Math.max(min, widthPx / Math.max(1, text.length * charWidth));
  return Math.max(min, Math.min(preferred, maxFromHeight, maxFromWidth));
}

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const RESIZE_HANDLES: ResizeHandle[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

export function resizeNormBox(box: NormBox, handle: ResizeHandle, dx: number, dy: number): NormBox {
  let { x, y, w, h } = box;
  if (handle.includes("e")) w += dx;
  if (handle.includes("s")) h += dy;
  if (handle.includes("w")) {
    x += dx;
    w -= dx;
  }
  if (handle.includes("n")) {
    y += dy;
    h -= dy;
  }
  const min = 0.008;
  if (w < min) {
    if (handle.includes("w")) x = box.x + box.w - min;
    w = min;
  }
  if (h < min) {
    if (handle.includes("n")) y = box.y + box.h - min;
    h = min;
  }
  return clampBox({ x, y, w, h });
}

export function moveNormBox(box: NormBox, dx: number, dy: number): NormBox {
  const round = (n: number) => Math.round(n * 1e6) / 1e6;
  const x = Math.min(1 - box.w, Math.max(0, box.x + dx));
  const y = Math.min(1 - box.h, Math.max(0, box.y + dy));
  return { x: round(x), y: round(y), w: box.w, h: box.h };
}

export function fontCss(font: EditorFont): {
  fontFamily: string;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  color: string;
} {
  return {
    fontFamily: font.css,
    fontWeight: font.bold ? 700 : 400,
    fontStyle: font.italic ? "italic" : "normal",
    color: fontColorCss(font),
  };
}

/** PDF user space: origin bottom-left. `box` is top-left normalized 0–1. */
export function stampRectPdf(
  box: NormBox,
  pageWidth: number,
  pageHeight: number,
): { x: number; y: number; w: number; h: number } {
  const w = box.w * pageWidth;
  const h = box.h * pageHeight;
  return {
    x: box.x * pageWidth,
    y: pageHeight - (box.y + box.h) * pageHeight,
    w,
    h,
  };
}

export function stampRectPixels(
  box: NormBox,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  return {
    x: box.x * width,
    y: box.y * height,
    w: box.w * width,
    h: box.h * height,
  };
}

export function pageHasSelectableText(regions: EditorRegion[], page: number): boolean {
  return regions.some(
    (region) =>
      region.page === page && region.source === "pdf" && regionObject(region) === "text" && region.text.trim(),
  );
}

export function alignedTextX(
  align: EditorAlign,
  left: number,
  width: number,
  textWidth: number,
  pad = 1,
): number {
  if (align === "center") return left + Math.max(pad, (width - textWidth) / 2);
  if (align === "right") return left + Math.max(pad, width - textWidth - pad);
  return left + pad;
}

export function regionAriaLabel(region: EditorRegion): string {
  const object = regionObject(region);
  if (object === "image") return "Image";
  if (object === "rect") return "Rectangle";
  if (object === "ellipse") return "Ellipse";
  if (object === "line") return "Line";
  const sample = region.text.trim() || "text box";
  return `Edit “${sample.slice(0, 40)}”`;
}

const INSERT_SIZE: Record<EditorObject, { w: number; h: number }> = {
  text: { w: 0.32, h: 0.07 },
  image: { w: 0.28, h: 0.2 },
  rect: { w: 0.22, h: 0.14 },
  ellipse: { w: 0.2, h: 0.14 },
  line: { w: 0.36, h: 0.014 },
};

export function nextInsertBox(existing: EditorRegion[], object: EditorObject): NormBox {
  const size = INSERT_SIZE[object];
  const drawn = existing.filter((region) => region.source === "draw").length;
  return clampBox({
    x: Math.min(0.62, 0.14 + (drawn % 5) * 0.05),
    y: Math.min(0.7, 0.16 + Math.floor(drawn / 5) * 0.08 + (drawn % 5) * 0.03),
    w: size.w,
    h: size.h,
  });
}

let drawSeq = 0;

export function makeDrawnRegion(opts: {
  page: number;
  object: EditorObject;
  existing: EditorRegion[];
  imageSrc?: string;
}): EditorRegion {
  drawSeq += 1;
  const box = nextInsertBox(opts.existing, opts.object);
  const shapeInk = { r: 0.24, g: 0.52, b: 0.78 };
  const font = fontFromBox(box, {
    kind: "helvetica",
    nh: opts.object === "text" ? 0.028 : 0.02,
    color: opts.object === "text" ? INK_BLACK : shapeInk,
  });
  const fill: EditorFill =
    opts.object === "line" || opts.object === "image"
      ? { kind: "none" }
      : opts.object === "text"
        ? cloneFill(FILL_WHITE)
        : { kind: "color", color: { ...shapeInk } };
  return {
    id: `draw-p${opts.page}-${drawSeq}`,
    page: opts.page,
    text: opts.object === "text" ? "Text" : "",
    original: "",
    box,
    originalBox: { x: 0, y: 0, w: 0, h: 0 },
    font,
    originalFont: cloneFont(font),
    source: "draw",
    object: opts.object,
    align: "left",
    originalAlign: "left",
    fill,
    originalFill: { kind: "none" },
    imageSrc: opts.imageSrc,
  };
}
