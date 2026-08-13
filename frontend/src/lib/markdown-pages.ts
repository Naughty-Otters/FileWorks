export const LINES_PER_PAGE = 40;
export const PAGES_PER_VIEW = 5;
export const LINES_PER_VIEW = LINES_PER_PAGE * PAGES_PER_VIEW;

export function splitLines(text: string): string[] {
  if (!text) return [];
  return text.split("\n");
}

export function joinLines(lines: string[]): string {
  return lines.join("\n");
}

export function linePageCount(lineCount: number, linesPerPage = LINES_PER_PAGE): number {
  if (lineCount <= 0) return 0;
  return Math.ceil(lineCount / linesPerPage);
}

export function pageWindowStart(total: number, start: number, size = PAGES_PER_VIEW): number {
  if (total <= 0) return 0;
  const maxStart = Math.floor((total - 1) / size) * size;
  return Math.max(0, Math.min(start, maxStart));
}

export function lineRangeForPages(
  pageStart: number,
  lineCount: number,
  linesPerPage = LINES_PER_PAGE,
  pagesPerView = PAGES_PER_VIEW,
): { startPage: number; endPage: number; lineStart: number; lineEnd: number; pageCount: number } {
  const pageCount = linePageCount(lineCount, linesPerPage);
  const startPage = pageWindowStart(pageCount, pageStart, pagesPerView);
  const lineStart = startPage * linesPerPage;
  const endPage = Math.min(pageCount, startPage + pagesPerView);
  const lineEnd = Math.min(lineCount, endPage * linesPerPage);
  return { startPage, endPage, lineStart, lineEnd, pageCount };
}

export function replaceLineRange(text: string, lineStart: number, lineEnd: number, nextSlice: string): string {
  const lines = splitLines(text);
  return joinLines([...lines.slice(0, lineStart), ...splitLines(nextSlice), ...lines.slice(lineEnd)]);
}
