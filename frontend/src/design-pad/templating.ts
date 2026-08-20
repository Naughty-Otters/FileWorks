import type { DesignDocument, DesignNode, TemplateVariable } from "./types";
import { VARIABLE_TOKEN_RE, nextId } from "./types";
import { effectiveDefault } from "./defaults";

export type TextSegment = { type: "text"; value: string } | { type: "var"; name: string };

/** Splits a string into literal-text and `{{ name }}` segments for design-time
 * token highlighting. */
export function parseSegments(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  let lastIndex = 0;
  const re = new RegExp(VARIABLE_TOKEN_RE.source, "g");
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ type: "text", value: text.slice(lastIndex, start) });
    segments.push({ type: "var", name: match[1] });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ type: "text", value: text.slice(lastIndex) });
  return segments;
}

/** True if the whole (trimmed) string is exactly one `{{ name }}` token. */
export function isPureVariableToken(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(/^\{\{\s*([a-zA-Z_][\w]*(?:\.[a-zA-Z_][\w]*)*)\s*\}\}$/);
  return match ? match[1] : null;
}

/** Substitutes `{{ name }}` with each variable's default value for Preview. */
export function resolveTemplate(text: string, variables: TemplateVariable[]): string {
  const data = defaultData(variables);
  return resolve(text, data, {});
}

export function extractUsedVariableNames(root: DesignNode): Set<string> {
  const names = new Set<string>();
  const walk = (node: DesignNode) => {
    for (const text of [node.label, node.imageSrc]) {
      if (!text) continue;
      for (const match of text.matchAll(new RegExp(VARIABLE_TOKEN_RE.source, "g"))) names.add(match[1]);
    }
    if (node.repeat?.over) names.add(node.repeat.over);
    node.children.forEach(walk);
  };
  walk(root);
  return names;
}

export function isStaticTemplate(doc: DesignDocument): boolean {
  if (doc.variables.length) return false;
  let dynamic = false;
  const walk = (node: DesignNode) => {
    const hasToken = (text?: string) => Boolean(text && new RegExp(VARIABLE_TOKEN_RE.source).test(text));
    if (node.repeat || hasToken(node.label) || hasToken(node.imageSrc)) dynamic = true;
    node.children.forEach(walk);
  };
  walk(doc.root);
  return !dynamic;
}

function defaultData(variables: TemplateVariable[]): Record<string, unknown> {
  return Object.fromEntries(
    variables.map((variable) => {
      const raw = effectiveDefault(variable);
      if (variable.type === "list") {
        try {
          const parsed = JSON.parse(raw || "[]");
          return [variable.name, Array.isArray(parsed) ? parsed : []];
        } catch {
          return [variable.name, []];
        }
      }
      if (variable.type === "object") {
        try {
          return [variable.name, JSON.parse(raw || "{}")];
        } catch {
          return [variable.name, {}];
        }
      }
      return [variable.name, raw];
    }),
  );
}

function lookup(path: string, data: Record<string, unknown>, locals: Record<string, unknown>): unknown {
  const parts = path.split(".");
  let value: unknown = parts[0] in locals ? locals[parts.shift()!] : data[parts.shift()!];
  for (const part of parts) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

function resolve(text: string, data: Record<string, unknown>, locals: Record<string, unknown>): string {
  return text.replace(new RegExp(VARIABLE_TOKEN_RE.source, "g"), (_token, name: string) => {
    const value = lookup(name, data, locals);
    return value == null || value === "" ? `⟨${name}⟩` : String(value);
  });
}

function expandNode(node: DesignNode, data: Record<string, unknown>, locals: Record<string, unknown>): DesignNode[] {
  if (node.repeat) {
    const list = lookup(node.repeat.over, data, locals);
    if (!Array.isArray(list)) return [];
    return list.map((item, index) => {
      const copy = structuredClone(node);
      delete copy.repeat;
      copy.id = nextId(`${node.id}_repeat_${index}`);
      return expandNode(copy, data, { ...locals, [node.repeat!.as]: item })[0];
    });
  }
  const copy = structuredClone(node);
  copy.label = resolve(copy.label, data, locals);
  if (copy.imageSrc) copy.imageSrc = resolve(copy.imageSrc, data, locals);
  copy.children = copy.children.flatMap((child) => expandNode(child, data, locals));
  relayout(copy);
  return [copy];
}

function relayout(node: DesignNode) {
  if (!node.layout || !node.children.length) return;
  const { direction, gap, padding } = node.layout;
  let cursor = padding;
  for (const child of node.children) {
    if (direction === "column") {
      child.x = padding;
      child.y = cursor;
      if (node.layout.align === "stretch") child.w = Math.max(20, node.w - padding * 2);
      cursor += child.h + gap;
    } else {
      child.x = cursor;
      child.y = padding;
      if (node.layout.align === "stretch") child.h = Math.max(20, node.h - padding * 2);
      cursor += child.w + gap;
    }
  }
  if (direction === "column") node.h = Math.max(node.h, cursor - gap + padding);
  else node.w = Math.max(node.w, cursor - gap + padding);
}

/** Full preview expansion including list repeats — uses default values. */
export function expandSampleDocument(doc: DesignDocument): DesignDocument {
  const data = defaultData(doc.variables);
  return { ...structuredClone(doc), root: expandNode(doc.root, data, {})[0] };
}
