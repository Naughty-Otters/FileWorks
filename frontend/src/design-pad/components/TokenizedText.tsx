"use client";
import type { ReactNode } from "react";
import type { TemplateVariable } from "../types";
import { parseSegments, resolveTemplate } from "../templating";

/** Renders literal text as-is, but a `{{ name }}` token either as a
 * highlighted pill (design mode) or substituted with its sample value
 * (preview mode). */
export function renderTokenizedText(
  text: string,
  previewMode: boolean,
  variables: TemplateVariable[],
): ReactNode {
  if (previewMode) return resolveTemplate(text, variables);
  const segments = parseSegments(text);
  if (segments.length <= 1 && segments[0]?.type === "text") return text;
  return segments.map((seg, i) =>
    seg.type === "var" ? (
      <span key={i} className="var-token">
        {seg.name}
      </span>
    ) : (
      <span key={i}>{seg.value}</span>
    ),
  );
}

export default function TokenizedText({
  text,
  previewMode,
  variables,
}: {
  text: string;
  previewMode: boolean;
  variables: TemplateVariable[];
}) {
  return <>{renderTokenizedText(text, previewMode, variables)}</>;
}
