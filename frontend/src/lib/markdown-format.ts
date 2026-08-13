export type FormatCommand =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "h1"
  | "h2"
  | "h3"
  | "ul"
  | "ol"
  | "quote"
  | "hr"
  | "link"
  | "image"
  | "img-smaller"
  | "img-larger"
  | "img-left"
  | "img-right"
  | "img-inline";

export type FormatExtra = {
  url?: string;
  alt?: string;
  dataUrl?: string;
};

export type FormatResult = {
  value: string;
  start: number;
  end: number;
};

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g;

export function applyMarkdownFormat(
  value: string,
  start: number,
  end: number,
  command: FormatCommand,
  extra?: FormatExtra,
): FormatResult {
  const from = Math.max(0, Math.min(start, end, value.length));
  const to = Math.max(0, Math.min(Math.max(start, end), value.length));

  switch (command) {
    case "bold":
      return wrapInline(value, from, to, "**", "**");
    case "italic":
      return wrapInline(value, from, to, "*", "*");
    case "strike":
      return wrapInline(value, from, to, "~~", "~~");
    case "code":
      return wrapInline(value, from, to, "`", "`");
    case "h1":
      return setLinePrefix(value, from, to, "# ");
    case "h2":
      return setLinePrefix(value, from, to, "## ");
    case "h3":
      return setLinePrefix(value, from, to, "### ");
    case "ul":
      return setLinePrefix(value, from, to, "- ", { list: true });
    case "ol":
      return setLinePrefix(value, from, to, "1. ", { list: true });
    case "quote":
      return setLinePrefix(value, from, to, "> ");
    case "hr":
      return insertAt(value, to, "\n\n---\n\n");
    case "link": {
      const href = (extra?.url || "https://").trim() || "https://";
      const label = value.slice(from, to) || "link";
      return replaceRange(value, from, to, `[${label}](${href})`);
    }
    case "image": {
      const src = extra?.dataUrl || extra?.url || "";
      if (!src) return { value, start: from, end: to };
      const alt = extra?.alt || "image";
      return insertAt(value, to, `![${alt}](${src})`);
    }
    case "img-smaller":
      return patchNearestImage(value, from, (width, align) => ({
        width: scaleWidth(width, 0.8),
        align,
      }));
    case "img-larger":
      return patchNearestImage(value, from, (width, align) => ({
        width: scaleWidth(width, 1.25),
        align,
      }));
    case "img-left":
      return patchNearestImage(value, from, (width) => ({ width, align: "left" }));
    case "img-right":
      return patchNearestImage(value, from, (width) => ({ width, align: "right" }));
    case "img-inline":
      return patchNearestImage(value, from, (width) => ({ width, align: "" }));
    default:
      return { value, start: from, end: to };
  }
}

function wrapInline(value: string, start: number, end: number, before: string, after: string): FormatResult {
  const selected = value.slice(start, end) || "text";
  if (
    start >= before.length &&
    value.slice(start - before.length, start) === before &&
    value.slice(end, end + after.length) === after
  ) {
    const next = value.slice(0, start - before.length) + selected + value.slice(end + after.length);
    const at = start - before.length;
    return { value: next, start: at, end: at + selected.length };
  }
  const next = value.slice(0, start) + `${before}${selected}${after}` + value.slice(end);
  return {
    value: next,
    start: start + before.length,
    end: start + before.length + selected.length,
  };
}

function setLinePrefix(
  value: string,
  start: number,
  end: number,
  prefix: string,
  options?: { list?: boolean },
): FormatResult {
  const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const lineEndIdx = value.indexOf("\n", end);
  const lineEnd = lineEndIdx < 0 ? value.length : lineEndIdx;
  const block = value.slice(lineStart, lineEnd);
  const heading = /^(#{1,6}\s+)/;
  const quote = /^(>\s+)/;
  const ul = /^(\s*[-*+]\s+)/;
  const ol = /^(\s*\d+\.\s+)/;
  const nextBlock = block
    .split("\n")
    .map((line) => {
      const stripped = line.replace(heading, "").replace(quote, "").replace(ul, "").replace(ol, "");
      if (options?.list && (ul.test(line) || ol.test(line)) && prefix === (ul.test(line) ? "- " : "1. ")) {
        return stripped;
      }
      if (!options?.list && line.startsWith(prefix)) return stripped;
      return prefix + stripped;
    })
    .join("\n");
  const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
  return { value: next, start: lineStart, end: lineStart + nextBlock.length };
}

function insertAt(value: string, index: number, snippet: string): FormatResult {
  const next = value.slice(0, index) + snippet + value.slice(index);
  const at = index + snippet.length;
  return { value: next, start: at, end: at };
}

function replaceRange(value: string, start: number, end: number, snippet: string): FormatResult {
  const next = value.slice(0, start) + snippet + value.slice(end);
  return { value: next, start, end: start + snippet.length };
}

function scaleWidth(width: number | null, factor: number): number {
  const base = width && width > 0 ? width : 160;
  return Math.round(Math.min(720, Math.max(48, base * factor)));
}

function parseTitle(title: string): { width: number | null; align: string } {
  let width: number | null = null;
  let align = "";
  for (const part of title.trim().split(/\s+/).filter(Boolean)) {
    if (/^\d+$/.test(part)) width = Number(part);
    else if (/^\d+x\d+$/.test(part)) width = Number(part.split("x")[0]);
    else if (part === "left" || part === "right") align = part;
  }
  return { width, align };
}

function patchNearestImage(
  value: string,
  caret: number,
  update: (width: number | null, align: string) => { width: number | null; align: string },
): FormatResult {
  IMAGE_RE.lastIndex = 0;
  let best: { start: number; end: number; alt: string; src: string; title: string } | null = null;
  let match: RegExpExecArray | null;
  while ((match = IMAGE_RE.exec(value))) {
    const start = match.index;
    const end = start + match[0].length;
    if (!best || Math.abs(caret - start) < Math.abs(caret - best.start) || (caret >= start && caret <= end)) {
      best = { start, end, alt: match[1], src: match[2], title: match[3] || "" };
      if (caret >= start && caret <= end) break;
    }
  }
  if (!best) return { value, start: caret, end: caret };
  const parsed = parseTitle(best.title);
  const next = update(parsed.width, parsed.align);
  const title = [next.width, next.align].filter(Boolean).join(" ");
  const snippet = title ? `![${best.alt}](${best.src} "${title}")` : `![${best.alt}](${best.src})`;
  const updated = value.slice(0, best.start) + snippet + value.slice(best.end);
  return { value: updated, start: best.start, end: best.start + snippet.length };
}
