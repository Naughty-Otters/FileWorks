import path from "node:path";

const FIXTURES_DIR = path.resolve(__dirname, "..", "fixtures");

export const fixtures = {
  dir: FIXTURES_DIR,
  txt: path.join(FIXTURES_DIR, "sample.txt"),
  md: path.join(FIXTURES_DIR, "sample.md"),
  png: path.join(FIXTURES_DIR, "sample.png"),
  pdf: path.join(FIXTURES_DIR, "sample.pdf"),
} as const;

/** Parse option keys accepted by POST /api/v1/convert and the workspace UI. */
export const PARSE_OPTION_KEYS = [
  "use_ai",
  "prefer_structure",
  "preserve_images",
  "ocr_high_quality",
  "use_doc_preprocessor",
  "use_table_recognition",
  "use_formula_recognition",
  "use_seal_recognition",
  "use_chart_recognition",
  "use_region_detection",
  "format_block_content",
] as const;

export type ParseOptionKey = (typeof PARSE_OPTION_KEYS)[number];

/** Labels shown in the workspace Options panel (must stay in sync with ExtractOptionsPanel). */
export const UI_OPTION_LABELS: Record<ParseOptionKey, string> = {
  use_ai: "Read with AI",
  prefer_structure: "Prefer structure",
  preserve_images: "Preserve images",
  ocr_high_quality: "High-quality OCR",
  use_doc_preprocessor: "Doc preprocessor",
  use_table_recognition: "Table recognition",
  use_formula_recognition: "Formula recognition",
  use_seal_recognition: "Seal recognition",
  use_chart_recognition: "Chart recognition",
  use_region_detection: "Region detection",
  format_block_content: "Format block content",
};

export const CONVERT_TARGETS = ["markdown", "txt", "html", "json", "docx"] as const;
export type ConvertTarget = (typeof CONVERT_TARGETS)[number];

/** Public marketing / docs routes that must load without auth. */
export const PUBLIC_PAGES = [
  { path: "/", title: /FileWorks|Convert/i },
  { path: "/pricing", title: /Pricing|FileWorks/i },
  { path: "/docs", title: /API|Convert|FileWorks/i },
  { path: "/about", title: /About|FileWorks/i },
  { path: "/legal", title: /Legal|Terms|FileWorks/i },
  { path: "/templates", title: /Design|Template|FileWorks/i },
  { path: "/login", title: /Sign|Login|FileWorks/i },
  { path: "/pdf-to-markdown", title: /PDF|Markdown|FileWorks/i },
  { path: "/word-to-markdown", title: /Word|Markdown|FileWorks/i },
  { path: "/excel-to-markdown", title: /Excel|Markdown|FileWorks/i },
  { path: "/powerpoint-to-markdown", title: /PowerPoint|Markdown|FileWorks/i },
  { path: "/image-to-markdown", title: /Image|Markdown|FileWorks/i },
] as const;
