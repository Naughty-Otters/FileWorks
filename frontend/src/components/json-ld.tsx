type JsonLdProps = {
  data: Record<string, unknown> | Array<Record<string, unknown>>;
};

/** Server-safe JSON-LD script for Google / AI crawlers. */
export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      // Structured data must be exact JSON; dangerouslySetInnerHTML is the Next.js pattern.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
