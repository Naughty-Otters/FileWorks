"use client";
import type { AlignmentGuide } from "../alignmentGuides";

export default function AlignmentGuides({
  guides,
  width,
  height,
}: {
  guides: AlignmentGuide[];
  width: number;
  height: number;
}) {
  if (guides.length === 0) return null;
  return (
    <div className="alignment-guides" style={{ width, height }}>
      {guides.map((g, i) =>
        g.axis === "x" ? (
          <div key={i} className="alignment-guide-v" style={{ left: g.position }} />
        ) : (
          <div key={i} className="alignment-guide-h" style={{ top: g.position }} />
        ),
      )}
    </div>
  );
}
