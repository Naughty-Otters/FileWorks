"use client";
import { useRef } from "react";
import type { TemplateVariable } from "../types";
import { renderTokenizedText } from "./TokenizedText";

interface Props {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  previewMode: boolean;
  variables: TemplateVariable[];
}

/** Content editor that keeps `{{ name }}` tokens highlighted in design
 * mode by mirroring the text in a backdrop layer under a transparent
 * textarea/input. */
export default function TokenizedContentField({
  value,
  onChange,
  multiline = false,
  previewMode,
  variables,
}: Props) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

  function syncScroll() {
    const backdrop = backdropRef.current;
    const input = inputRef.current;
    if (!backdrop || !input) return;
    backdrop.scrollTop = input.scrollTop;
    backdrop.scrollLeft = input.scrollLeft;
  }

  const field = (
    <>
      <div
        ref={backdropRef}
        className={`tokenized-backdrop${multiline ? " multiline" : ""}`}
        aria-hidden
      >
        {renderTokenizedText(value, previewMode, variables)}
      </div>
      {multiline ? (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          className="tokenized-input content-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
        />
      ) : (
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          className="tokenized-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
        />
      )}
    </>
  );

  return <div className="tokenized-field">{field}</div>;
}
