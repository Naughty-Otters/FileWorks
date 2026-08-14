const PETAL_ANGLES = [0, 60, 120, 180, 240, 300] as const;

/** Six interlocking rings — round OpenAI-like blossom with readable line work. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true" fill="none">
      <g
        transform="translate(24 24)"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {PETAL_ANGLES.map((deg) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          return <circle key={deg} cx={Math.cos(rad) * 9.15} cy={Math.sin(rad) * 9.15} r="9.15" />;
        })}
      </g>
    </svg>
  );
}
