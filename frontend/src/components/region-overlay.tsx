"use client";

import { useMemo, useRef, useState } from "react";
import type { ImageSize, RegionBox } from "@/lib/api";
import { cn } from "@/lib/utils";

type AnnotatedImageProps = {
  src: string;
  alt: string;
  regions: RegionBox[];
  imageSize: ImageSize | null;
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
};

const LABEL_COLORS: Record<string, string> = {
  doc_title: "#0f6e56",
  paragraph_title: "#1d6f9c",
  text: "#5a675f",
  table: "#a35b1f",
  image: "#6b4ea3",
  formula: "#9a3d6a",
  seal: "#a33b2d",
  chart: "#2f6f7e",
};

function colorFor(label: string) {
  return LABEL_COLORS[label] || "#0f6e56";
}

export function AnnotatedImage({
  src,
  alt,
  regions,
  imageSize,
  activeId,
  onActiveChange,
}: AnnotatedImageProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const basis = useMemo(() => {
    if (imageSize?.width && imageSize?.height) {
      return { w: imageSize.width, h: imageSize.height };
    }
    return natural;
  }, [imageSize, natural]);

  const pageRegions = useMemo(
    () => regions.filter((r) => (r.page ?? 1) === 1),
    [regions],
  );

  return (
    <div ref={wrapRef} className="relative mx-auto max-h-full max-w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="block max-h-full max-w-full rounded-xl object-contain shadow-[var(--shadow)]"
        onLoad={(e) => {
          const img = e.currentTarget;
          setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        }}
      />
      {basis && pageRegions.length > 0 ? (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full rounded-xl"
          viewBox={`0 0 ${basis.w} ${basis.h}`}
          preserveAspectRatio="xMidYMid meet"
        >
          {pageRegions.map((region) => {
            const [x1, y1, x2, y2] = region.bbox;
            const active = activeId === region.id;
            const color = colorFor(region.label);
            return (
              <g key={region.id} className="pointer-events-auto">
                <rect
                  x={x1}
                  y={y1}
                  width={Math.max(1, x2 - x1)}
                  height={Math.max(1, y2 - y1)}
                  fill={active ? color : "transparent"}
                  fillOpacity={active ? 0.18 : 0}
                  stroke={color}
                  strokeWidth={active ? Math.max(basis.w, basis.h) * 0.0035 : Math.max(basis.w, basis.h) * 0.0022}
                  strokeOpacity={active ? 1 : 0.7}
                  rx={Math.max(basis.w, basis.h) * 0.002}
                  className="cursor-pointer transition-all"
                  onMouseEnter={() => onActiveChange(region.id)}
                  onMouseLeave={() => onActiveChange(null)}
                  onClick={() => onActiveChange(region.id)}
                />
                <title>{`${region.label}: ${region.text || "(no text)"}`}</title>
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}

type RegionListProps = {
  regions: RegionBox[];
  activeId: string | null;
  onActiveChange: (id: string | null) => void;
};

export function RegionList({ regions, activeId, onActiveChange }: RegionListProps) {
  if (!regions.length) {
    return (
      <p className="px-1 py-4 text-xs text-[var(--ink-muted)]">
        No layout regions yet. Convert a file to see detected blocks.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {regions.map((region, index) => {
        const active = activeId === region.id;
        return (
          <li key={`${region.id}-${index}`}>
            <button
              type="button"
              onMouseEnter={() => onActiveChange(region.id)}
              onMouseLeave={() => onActiveChange(null)}
              onFocus={() => onActiveChange(region.id)}
              onBlur={() => onActiveChange(null)}
              className={cn(
                "w-full rounded-xl border px-3 py-2 text-left transition",
                active
                  ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                  : "border-[var(--line)] hover:border-[color-mix(in_oklab,var(--accent)_45%,var(--line))]",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ background: colorFor(region.label) }}
                />
                <span className="text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
                  {region.label.replaceAll("_", " ")}
                </span>
                <span className="ml-auto text-[10px] text-[var(--ink-muted)]">#{region.order ?? index + 1}</span>
              </span>
              <span className="mt-1 block line-clamp-2 text-sm text-[var(--ink)]">
                {region.text || "(visual region)"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
