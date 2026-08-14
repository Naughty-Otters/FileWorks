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

/**
 * First line of each real page, found from the `---` separators the backend writes
 * between pages. A `---` under a non-blank line is a setext heading, not a break.
 */
export function pageStartLines(lines: string[]): number[] {
  const starts = [0];
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() !== "---" || lines[index - 1].trim() !== "") continue;
    let next = index + 1;
    while (next < lines.length && lines[next].trim() === "") next += 1;
    if (next < lines.length && next > starts[starts.length - 1]) starts.push(next);
  }
  return starts;
}

/**
 * Window of the document to render. Pass the split lines to page on real page
 * boundaries; a bare line count falls back to fixed blocks for unpaged text.
 */
export function lineRangeForPages(
  pageStart: number,
  source: number | string[],
  linesPerPage = LINES_PER_PAGE,
  pagesPerView = PAGES_PER_VIEW,
): { startPage: number; endPage: number; lineStart: number; lineEnd: number; pageCount: number } {
  const lineCount = typeof source === "number" ? source : source.length;
  const starts = typeof source === "number" ? [0] : pageStartLines(source);

  if (starts.length > 1) {
    const pageCount = starts.length;
    const startPage = pageWindowStart(pageCount, pageStart, pagesPerView);
    const endPage = Math.min(pageCount, startPage + pagesPerView);
    return {
      startPage,
      endPage,
      lineStart: starts[startPage],
      lineEnd: endPage >= pageCount ? lineCount : starts[endPage],
      pageCount,
    };
  }

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
