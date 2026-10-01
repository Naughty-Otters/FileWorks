import type { Metadata } from "next";
import { BUSINESS_NAME, LEGAL_ENTITY_NAME, SITE_HOST, SITE_URL, SUPPORT_EMAIL } from "@/lib/legal";
import {
  apiDocsFaqAnswer,
  casualAiAllowanceFaqAnswer,
  casualFreeTierFaqAnswer,
  casualOfferDescription,
  freeCasualCardFaqAnswer,
  pricingCostFaqAnswer,
} from "@/lib/plan-quotas";

export const DEFAULT_OG_IMAGE = "/opengraph-image.png";
export const LOGO_URL = `${SITE_URL}/icons/icon-512.png`;

/** Primary search phrases competitors already target for this category. */
export const PRIMARY_KEYWORDS = [
  "PDF to Markdown",
  "DOCX to Markdown",
  "Word to Markdown",
  "Excel to Markdown",
  "PowerPoint to Markdown",
  "image to Markdown",
  "CSV to Markdown",
  "EPUB to Markdown",
  "scanned PDF OCR",
  "document to Markdown converter",
  "PDF OCR to Markdown",
  "convert PDF to Markdown online",
  "Markdown converter API",
  "AI document conversion",
  "AI OCR Markdown",
  "document translation to Markdown",
  "translate PDF to Markdown",
  "multilingual document converter",
  "fillable document designs",
  "edit PDF text online",
  "edit text on a PDF",
  "document designs from PDF",
  "family schedule design",
  "meeting agenda design",
  // Search aliases — people still query “template”
  "fillable document templates",
  "PDF to invoice template",
  "family schedule template",
  "meeting agenda template",
] as const;

export const TEMPLATE_KEYWORDS = [
  "document designs",
  "fillable document designs",
  "invoice design from PDF",
  "NDA template",
  "business proposal design",
  "purchase order template",
  "job offer letter template",
  "family daily schedule design",
  "weekly family planner",
  "yearly family calendar",
  "meeting agenda design",
  "project plan design",
  "task list design",
  "timesheet design",
  "AI fill document design",
  "design render API",
  // Search aliases
  "document templates",
  "fillable PDF templates",
  "AI fill document template",
  "template render API",
] as const;

export const INPUT_FORMATS = [
  "PDF",
  "Word (.doc, .docx)",
  "Excel (.xls, .xlsx)",
  "PowerPoint (.ppt, .pptx)",
  "OpenDocument (.odt, .ods, .odp)",
  "CSV",
  "RTF",
  "EPUB",
  "images (PNG, JPEG, WebP, BMP, TIFF)",
  "scans",
  "Markdown",
  "TXT",
] as const;

export const OUTPUT_FORMATS = ["Markdown", "TXT", "HTML", "JSON", "Word (.docx)", "print PDF"] as const;

export const SITE_DESCRIPTION =
  "Drop a file to edit text on the page, or produce a finished Design. Convert PDF, Word, Excel, PowerPoint, images, and scans; optionally AI-read and translate; fill Markdown reports, invoices, family schedules, agendas, and more. Workspace from free Casual; Convert API from free with AI page credits.";

export const SITE_TAGLINE = "Drop a file. Edit the page, or produce a Design.";

export type FaqItem = { question: string; answer: string };

export const HOME_FAQS: FaqItem[] = [
  {
    question: "What file types can FileWorks convert to Markdown?",
    answer:
      "FileWorks accepts PDF, Microsoft Word, Excel, PowerPoint, OpenDocument, CSV, RTF, EPUB, PNG, JPEG, WebP, BMP, TIFF, Markdown, and TXT (up to 50 MB). Output can be Markdown, TXT, HTML, JSON, DOCX, or a print-ready PDF.",
  },
  {
    question: "Can FileWorks convert scanned PDFs and photos with OCR?",
    answer:
      "Yes. Enable AI reading for image-only PDFs, phone photos of pages, and other scans. AI reading uses 1 page credit on the Convert API or your workspace AI page allowance.",
  },
  {
    question: "Is there a PDF to Markdown API?",
    answer: apiDocsFaqAnswer(),
  },
  {
    question: "Does FileWorks translate documents?",
    answer:
      "Yes. Optionally translate into 19 languages in the same conversion pass as PDF or office extraction. Translation shares the AI page allowance on workspace plans and uses 1 Convert API credit per page.",
  },
  {
    question: "Can I turn converted Markdown into invoices, schedules, or agendas?",
    answer:
      "Yes. Choose a Design in the workspace (family daily/weekly/monthly/yearly schedules, invoices, receipts, meeting agendas, project plans, task lists, timesheets, and more). FileWorks AI-fills the Design placeholders from the extracted Markdown. Via Convert API, pass design=invoice (or another starter id) on POST /api/v1/convert.",
  },
  {
    question: "How much does FileWorks cost?",
    answer: pricingCostFaqAnswer(),
  },
];

export const TEMPLATE_FAQS: FaqItem[] = [
  {
    question: "What built-in document designs does FileWorks include?",
    answer:
      "Starter designs are grouped into Family (daily, weekly, monthly, and yearly schedules), Business (invoice, receipt, statement, pay stub, insurance, rental, letter, meeting agenda, project plan, task list, timesheet), and General (markdown report). Each declares placeholders and list fields you can fill from converted Markdown or the API. (Search engines may still call these templates.)",
  },
  {
    question: "How do I fill a Design from a PDF or Word file?",
    answer:
      "In the workspace, convert the file to Markdown, then pick Produce as a starter design. With AI fill enabled, FileWorks maps extracted content into the Design placeholders and list rows, then renders HTML, DOCX, or print PDF.",
  },
  {
    question: "Is there an API for built-in Design starters?",
    answer:
      "Yes. POST /api/v1/convert with design=<starter_id> (invoice, family_daily, …) fills that Design from the extracted Markdown. GET /api/v1/convert lists available designs. Creating or editing custom Designs remains in the signed-in Design studio, not the Convert API.",
  },
];

export const PRICING_FAQS: FaqItem[] = [
  {
    question: "What is the difference between workspace and Convert API plans?",
    answer:
      "Workspace roles (Casual, Daily, Expert) cover the FileWorks web app: conversion fair-use, AI reading, translation, history, and downloads. Convert API plans bill AI page credits and API keys separately. Standard API convert is free up to a monthly page cap. Both can be active on one account.",
  },
  {
    question: "How do Convert API page credits work?",
    answer:
      "Standard conversion is free (monthly page cap). AI reading, translation, or Design auto-fill costs 1 credit per page. Unused monthly credits reset with the billing period; keys do not expire.",
  },
  {
    question: "Can I cancel or get a refund?",
    answer:
      "Yes. Cancel anytime from Stripe Customer Portal or Profile. Refund and dispute rules are published on the Legal page. Contact support@fileworks.ai for billing help.",
  },
  {
    question: "Do I need to pay to try PDF to Markdown?",
    answer: freeCasualCardFaqAnswer(),
  },
];

export type ComparisonRow = { aspect: string; fileworks: string; typical: string };

export type ConvertGuide = {
  slug: string;
  path: string;
  title: string;
  headline: string;
  description: string;
  intro: string;
  bullets: string[];
  steps: string[];
  useCases: string[];
  /** Real curl example against the public Convert API, shown on the guide page. */
  apiExample: string;
  /** Lead-in for the comparison table, naming the specific failure mode of generic converters. */
  comparisonIntro: string;
  comparisonRows: ComparisonRow[];
  /** Format-specific troubleshooting, not generic advice — what actually goes wrong and why. */
  tips: string[];
  faqs: FaqItem[];
  related: string[];
  /** First-published date (YYYY-MM-DD), for accurate structured-data freshness signals. */
  publishedDate: string;
};

export const CONVERT_GUIDES: ConvertGuide[] = [
  {
    slug: "pdf-to-markdown",
    path: "/pdf-to-markdown",
    title: "PDF to Markdown with AI & translation",
    headline: "Convert PDF to Markdown — AI reading & translation",
    description:
      "Turn PDFs into editable Markdown online. AI reading for scanned/OCR pages, plus translation into 19 languages in one pass. Free Casual plan.",
    intro:
      "PDFs keep layout for printing, not for editing or feeding LLMs. FileWorks converts PDF layout into Markdown for Obsidian, Cursor, ChatGPT, Claude, docs repos, and RAG pipelines. Enable AI reading for scans, and optionally translate the result into 19 languages without a second tool.",
    bullets: [
      "Preserve headings, lists, and tables as Markdown structure",
      "AI reading (OCR) for scanned and image-only PDFs",
      "Translate into 19 languages in the same conversion pass",
      "Download Markdown, HTML, TXT, JSON, DOCX, or print PDF — or use the Convert API",
    ],
    steps: [
      "Open the FileWorks workspace and drop a PDF (up to 50 MB).",
      "Turn on AI reading for scans; pick a target language if you want translation.",
      "Convert, then edit Markdown in the preview or download the result.",
    ],
    useCases: [
      "Developers and AI agents pulling PDF content into RAG pipelines or LLM context windows",
      "Writers and researchers moving papers and reports into Obsidian or Git-backed docs",
      "Teams digitizing scanned contracts or forms with OCR before archiving as Markdown",
    ],
    apiExample: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  -F file=@report.pdf \\
  -F target=markdown \\
  -F download=true \\
  -o report.md \\
  https://api.fileworks.ai/api/v1/convert`,
    comparisonIntro:
      "Most free PDF-to-Markdown tools either flatten everything into plain text or choke on scanned pages. Here's how FileWorks handles the same PDF differently.",
    comparisonRows: [
      {
        aspect: "Scanned / image-only pages",
        fileworks: "AI reading (OCR) extracts text and keeps structure, in the same pass",
        typical: "Usually skipped, or dumped as empty or garbled text",
      },
      {
        aspect: "Tables",
        fileworks: "Rebuilt as Markdown pipe tables",
        typical: "Often flattened into run-on paragraphs",
      },
      {
        aspect: "Translation",
        fileworks: "Optional, into 19 languages, in the same conversion pass",
        typical: "Not offered — needs a second tool",
      },
      {
        aspect: "Automation",
        fileworks: "Convert API with curl, Python, and JavaScript examples, free tier included",
        typical: "Browser-only, or an API that's paid-only",
      },
      {
        aspect: "File size",
        fileworks: "Up to 50 MB per PDF",
        typical: "Often capped at 5–10 MB on free tiers",
      },
    ],
    tips: [
      "If headings come out as plain paragraphs, the PDF likely has no real heading styles — turn on AI reading, which infers structure from layout instead of relying on embedded tags.",
      "For multi-column PDFs (two-column papers, newsletters), AI reading reads in natural reading order; without it, columns can interleave line-by-line.",
      "Translating a long PDF? Convert first, confirm the Markdown structure looks right, then re-run with a target language — it's cheaper to fix structure once before translating.",
    ],
    faqs: [
      {
        question: "Is PDF to Markdown free on FileWorks?",
        answer: casualFreeTierFaqAnswer(),
      },
      {
        question: "Can I OCR and translate a PDF in one step?",
        answer:
          "Yes. Enable AI reading for image-only or poorly selectable PDFs, and set a translation language. Both share the workspace AI page allowance, or Convert API AI credits (1 per page).",
      },
      {
        question: "Does PDF to Markdown conversion keep tables and headings?",
        answer:
          "Yes. FileWorks maps PDF headings, lists, and tables to Markdown structure (#, -, and pipe tables) instead of flattening the page into plain text, so the output stays editable and LLM-friendly.",
      },
      {
        question: "Is there a file size limit for PDF to Markdown?",
        answer: "PDFs up to 50 MB are accepted, whether uploaded in the workspace or via the Convert API.",
      },
    ],
    related: [
      "word-to-markdown",
      "image-to-markdown",
      "excel-to-markdown",
      "powerpoint-to-markdown",
      "csv-to-markdown",
      "epub-to-markdown",
    ],
    publishedDate: "2026-08-16",
  },
  {
    slug: "word-to-markdown",
    path: "/word-to-markdown",
    title: "Word to Markdown with AI & translation",
    headline: "Convert Word (DOCX) to Markdown — translate too",
    description:
      "Convert Word .doc/.docx to editable Markdown online. AI cleanup for hard pages, plus translation into 19 languages in one pass. Free Casual plan.",
    intro:
      "Move Word drafts into Markdown without hand-fixing headings and lists. FileWorks accepts .doc and .docx, extracts structure, and can translate into 19 languages in the same pass — then you edit in the workspace or export again as DOCX, HTML, or PDF.",
    bullets: [
      "Support for .doc and .docx uploads",
      "Editable Markdown preview with formatting toolbar",
      "Optional AI reading when pages need stronger extraction",
      "Translate into 19 languages in one pass; API for batch pipelines",
    ],
    steps: [
      "Upload a Word file in the workspace.",
      "Optionally enable AI reading and choose a translation language.",
      "Convert, review Markdown, then download or re-export to HTML, DOCX, or PDF.",
    ],
    useCases: [
      "Writers moving drafts and long reports from Word into Markdown-based docs tools",
      "Developers feeding Word specs or requirements into coding agents and LLM prompts",
      "Teams translating Word policies or contracts into another language in the same pass",
    ],
    apiExample: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  -F file=@report.docx \\
  -F target=markdown \\
  -F download=true \\
  -o report.md \\
  https://api.fileworks.ai/api/v1/convert`,
    comparisonIntro:
      "DOCX files carry heavier internal formatting than most converters expect. Here's where that usually breaks, and how FileWorks avoids it.",
    comparisonRows: [
      {
        aspect: "Nested or numbered lists",
        fileworks: "Preserved as ordered/unordered Markdown lists, including nesting",
        typical: "Nesting frequently collapses into a single flat list",
      },
      {
        aspect: "Tables",
        fileworks: "Converted to Markdown pipe tables",
        typical: "Often rendered as tab-separated text, or dropped",
      },
      {
        aspect: "Legacy .doc files",
        fileworks: "Accepted directly, same pipeline as .docx",
        typical: "Frequently unsupported, requiring a manual re-save to .docx first",
      },
      {
        aspect: "Translation",
        fileworks: "Optional 19-language translation in the same pass",
        typical: "Not offered",
      },
      {
        aspect: "Re-export",
        fileworks: "Export back to DOCX, HTML, or PDF after editing",
        typical: "One-way conversion only",
      },
    ],
    tips: [
      "If bullet indentation looks off after conversion, it's usually because the Word doc used manual spaces or tabs instead of real list styles — AI reading can often recover the intended structure.",
      "Track changes and comments aren't preserved in Markdown by design — accept or resolve them in Word before converting if you need the clean final text.",
      "For legacy .doc files with embedded OLE objects (old Excel charts, etc.), expect the surrounding text to extract but not the live chart — convert the source spreadsheet separately if you need that data.",
    ],
    faqs: [
      {
        question: "Can I convert and translate DOCX with an API?",
        answer:
          "Yes. Use POST /api/v1/convert with target=markdown, optional use_ai=true, and target_lang. Auth with a fw_live_ API key. See the API docs for curl, Python, and JavaScript examples.",
      },
      {
        question: "Does Word to Markdown keep headings, lists, and tables?",
        answer:
          "Yes. FileWorks extracts Word document structure — headings, numbered and bulleted lists, and tables — into Markdown syntax instead of dumping raw paragraph text.",
      },
      {
        question: "Is there a file size limit for Word to Markdown?",
        answer: "Word files up to 50 MB are accepted, whether uploaded in the workspace or via the Convert API.",
      },
    ],
    related: [
      "pdf-to-markdown",
      "powerpoint-to-markdown",
      "excel-to-markdown",
      "image-to-markdown",
      "csv-to-markdown",
      "epub-to-markdown",
    ],
    publishedDate: "2026-08-16",
  },
  {
    slug: "excel-to-markdown",
    path: "/excel-to-markdown",
    title: "Excel to Markdown with translation",
    headline: "Convert Excel to Markdown tables — with translation",
    description:
      "Convert Excel .xls/.xlsx into Markdown tables online. Optional translation into 19 languages. Great for reports, docs, and LLM context. Free plan.",
    intro:
      "Spreadsheets do not paste cleanly into notes or prompts. FileWorks turns Excel workbooks into Markdown you can edit, share, or send to an API — and optionally translate cell text into 19 languages in the same pass. CSV and OpenDocument spreadsheets are supported too.",
    bullets: [
      "Accepts .xls, .xlsx, .ods, and CSV",
      "Markdown table-oriented output for structured sheets",
      "Optional translation into 19 languages",
      "Automate with the Convert API (AI / translation use 1 credit per page)",
    ],
    steps: [
      "Drop an Excel or CSV file into the workspace.",
      "Optionally choose a translation language, then convert.",
      "Inspect tables in Markdown preview, download, or call the same path from scripts.",
    ],
    useCases: [
      "Analysts turning spreadsheet exports into Markdown tables for reports and wikis",
      "Developers piping CSV/Excel data into LLM prompts or RAG pipelines as structured tables",
      "Teams translating spreadsheet text for multilingual reporting in one conversion pass",
    ],
    apiExample: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  -F file=@report.xlsx \\
  -F target=markdown \\
  -F download=true \\
  -o report.md \\
  https://api.fileworks.ai/api/v1/convert`,
    comparisonIntro:
      "Spreadsheets aren't really \"text\" at all. Here's how FileWorks' tabular pipeline differs from general-purpose converters.",
    comparisonRows: [
      {
        aspect: "Formats accepted",
        fileworks: ".xls, .xlsx, .ods, and CSV through one pipeline",
        typical: "Usually one spreadsheet format only",
      },
      {
        aspect: "Merged cells",
        fileworks: "Resolved into clean Markdown table rows",
        typical: "Often produces broken or misaligned table syntax",
      },
      {
        aspect: "Translation",
        fileworks: "Optional cell-text translation into 19 languages",
        typical: "Not offered",
      },
      {
        aspect: "Automation",
        fileworks: "Convert API, same request shape as PDF, Word, and CSV",
        typical: "Spreadsheet-specific tools rarely expose an API",
      },
      {
        aspect: "File size",
        fileworks: "Up to 50 MB per workbook",
        typical: "Often capped well below real-world export sizes",
      },
    ],
    tips: [
      "Very wide sheets (20+ columns) make Markdown tables hard to read — convert a filtered range instead of the whole sheet if you're pasting the result into a chat or doc.",
      "Formulas convert to their last calculated value, not the formula text — recalculate and save in Excel before converting if a cell shows a stale number.",
      "For recurring exports (a weekly report, say), the Convert API lets you script the xlsx-to-Markdown step instead of re-uploading by hand each time.",
    ],
    faqs: [
      {
        question: "Does Excel to Markdown keep multiple sheets?",
        answer:
          "FileWorks extracts spreadsheet content into Markdown suitable for reading and editing. For large multi-sheet books, convert focused ranges or use the API in a loop over exports. Translation applies to extracted text in the same pass.",
      },
      {
        question: "Can I automate Excel to Markdown conversion?",
        answer:
          "Yes. POST /api/v1/convert with an Excel, CSV, or OpenDocument spreadsheet and target=markdown returns Markdown tables over the Convert API — standard conversion is free up to the monthly page cap.",
      },
      {
        question: "Is there a file size limit for Excel to Markdown?",
        answer: "Spreadsheets up to 50 MB are accepted, whether uploaded in the workspace or via the Convert API.",
      },
    ],
    related: [
      "word-to-markdown",
      "pdf-to-markdown",
      "powerpoint-to-markdown",
      "image-to-markdown",
      "csv-to-markdown",
      "epub-to-markdown",
    ],
    publishedDate: "2026-08-16",
  },
  {
    slug: "powerpoint-to-markdown",
    path: "/powerpoint-to-markdown",
    title: "PowerPoint to Markdown with AI & translation",
    headline: "Convert PowerPoint to Markdown — AI & translation",
    description:
      "Convert PowerPoint .ppt/.pptx into editable Markdown online. AI reading for image-heavy slides, translation into 19 languages. Free Casual plan.",
    intro:
      "Slide decks are awkward to quote in docs and agents. FileWorks converts PowerPoint into Markdown so you can summarize, search, and reuse the content. Use AI reading when slides are image-heavy, and optionally translate into 19 languages in one pass.",
    bullets: [
      "Accepts .ppt, .pptx, and .odp",
      "Text-first Markdown for notes and LLM context",
      "AI reading when slides are image-heavy or scanned",
      "Translate into 19 languages; same pipeline over the Convert API",
    ],
    steps: [
      "Upload a PowerPoint file (up to 50 MB).",
      "Optionally enable AI reading and pick a translation language.",
      "Convert, edit the Markdown outline, then download or integrate via API keys.",
    ],
    useCases: [
      "Developers and AI agents chunking slide decks into Markdown for RAG ingestion",
      "Teams turning image-heavy decks into searchable, text-first Markdown notes",
      "Presenters translating slide content into another language before reuse",
    ],
    apiExample: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  -F file=@deck.pptx \\
  -F target=markdown \\
  -F download=true \\
  -o deck.md \\
  https://api.fileworks.ai/api/v1/convert`,
    comparisonIntro:
      "Slide decks pack most of their meaning into visual layout, not text flow. Here's the difference in practice.",
    comparisonRows: [
      {
        aspect: "Image-heavy slides",
        fileworks: "AI reading extracts on-slide text via OCR-style reading",
        typical: "Slides with text-in-images usually convert to blank sections",
      },
      {
        aspect: "Speaker notes",
        fileworks: "Captured alongside slide content, kept text-first",
        typical: "Often dropped entirely",
      },
      {
        aspect: "Formats",
        fileworks: ".ppt, .pptx, and .odp through one pipeline",
        typical: "Usually .pptx only",
      },
      {
        aspect: "Translation",
        fileworks: "Optional translation of slide text into 19 languages",
        typical: "Not offered",
      },
      {
        aspect: "RAG / agent use",
        fileworks: "Clean per-slide Markdown headings, better for chunking",
        typical: "Raw text dumps with no slide boundaries",
      },
    ],
    tips: [
      "If a slide's text comes back empty, the text is probably embedded in a picture — turn on AI reading so OCR can pull it out.",
      "Decks with heavy SmartArt or diagrams convert the surrounding labels and text, not the diagram shape itself — re-describe complex diagrams manually if you need that detail in Markdown.",
      "Converting for RAG ingestion? Keep slide titles short and descriptive in the source deck — they become your Markdown headings and chunk boundaries.",
    ],
    faqs: [
      {
        question: "Can I convert and translate PPTX for RAG ingestion?",
        answer:
          "Yes. Markdown with clear structure chunks more reliably than binary PPTX. Use AI reading for image-heavy decks and target_lang for translation, in the web app or via the Convert API.",
      },
      {
        question: "Does FileWorks convert .ppt and .odp, or only .pptx?",
        answer:
          "All three. FileWorks accepts .ppt, .pptx, and OpenDocument .odp presentations and converts each into text-first Markdown, with AI reading available for image-heavy or scanned slides.",
      },
      {
        question: "Is there a file size limit for PowerPoint to Markdown?",
        answer: "Presentations up to 50 MB are accepted, whether uploaded in the workspace or via the Convert API.",
      },
    ],
    related: [
      "pdf-to-markdown",
      "word-to-markdown",
      "image-to-markdown",
      "excel-to-markdown",
      "csv-to-markdown",
      "epub-to-markdown",
    ],
    publishedDate: "2026-08-16",
  },
  {
    slug: "image-to-markdown",
    path: "/image-to-markdown",
    title: "Image OCR to Markdown with AI & translation",
    headline: "AI OCR images & scans to Markdown — translate too",
    description:
      "Convert PNG/JPEG/WebP/TIFF photos and scans into editable Markdown with AI OCR, then optional translation into 19 languages. Free Casual plan.",
    intro:
      "Phone photos of whiteboards, receipts, and paper scans are not selectable text. FileWorks AI reading performs OCR-style extraction and returns Markdown you can edit, translate into 19 languages, and download — without a separate OCR or translation app.",
    bullets: [
      "PNG, JPEG, WebP, BMP, and TIFF uploads",
      "AI reading for scans and photo documents",
      "Translate OCR text into 19 languages in the same pass",
      "Bill against workspace AI / translation allowance or API credits",
    ],
    steps: [
      "Upload an image or scanned page.",
      "Enable AI reading and optionally choose a translation language.",
      "Convert, edit Markdown, then download or re-export.",
    ],
    useCases: [
      "Digitizing paper forms, receipts, and whiteboard photos into editable Markdown",
      "Developers OCR-ing scanned archives for search or RAG ingestion",
      "Teams translating photographed foreign-language documents in the same pass",
    ],
    apiExample: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  -F file=@scan.png \\
  -F target=markdown \\
  -F use_ai=true \\
  -F download=true \\
  -o scan.md \\
  https://api.fileworks.ai/api/v1/convert`,
    comparisonIntro: "A photo of a page is pixels, not text — the gap between tools shows up here.",
    comparisonRows: [
      {
        aspect: "Handwriting / low-light scans",
        fileworks: "AI reading handles moderately messy scans and phone photos",
        typical: "Basic OCR tools often fail outside clean, flat scans",
      },
      {
        aspect: "Formats",
        fileworks: "PNG, JPEG, WebP, BMP, and TIFF in one flow",
        typical: "Frequently JPEG/PNG only",
      },
      {
        aspect: "Translation",
        fileworks: "Optional translation of OCR'd text into 19 languages",
        typical: "Needs a second translation tool",
      },
      {
        aspect: "Output",
        fileworks: "Structured Markdown (headings/lists where detectable), not just a text blob",
        typical: "Usually plain, unstructured text",
      },
      {
        aspect: "Batch use",
        fileworks: "Script per-image calls over the Convert API",
        typical: "One image at a time in a browser UI",
      },
    ],
    tips: [
      "For whiteboard photos, shoot straight-on if possible — heavy perspective skew causes more OCR mistakes than messy handwriting does.",
      "Receipts and forms with small print convert more reliably at higher photo resolution — a blurry 1 MB photo OCRs worse than a sharp 5 MB one, even though both are well under the 50 MB limit.",
      "If you're OCR-ing a multi-page scan, convert and save each page's Markdown separately so one bad page doesn't force you to redo the whole batch.",
    ],
    faqs: [
      {
        question: "Is AI OCR and translation included on the free plan?",
        answer: casualAiAllowanceFaqAnswer(),
      },
      {
        question: "Can I batch-convert multiple scanned images at once?",
        answer:
          "In the workspace, upload images one at a time through the editor; for bulk OCR pipelines, call POST /api/v1/convert per image with use_ai=true from a script or the Convert API in a loop.",
      },
      {
        question: "Is there a file size limit for image OCR to Markdown?",
        answer: "Images and scans up to 50 MB are accepted, whether uploaded in the workspace or via the Convert API.",
      },
    ],
    related: [
      "pdf-to-markdown",
      "word-to-markdown",
      "powerpoint-to-markdown",
      "excel-to-markdown",
      "csv-to-markdown",
      "epub-to-markdown",
    ],
    publishedDate: "2026-08-16",
  },
  {
    slug: "csv-to-markdown",
    path: "/csv-to-markdown",
    title: "CSV to Markdown table converter",
    headline: "Convert CSV to Markdown tables — with translation",
    description:
      "Convert CSV files into Markdown tables online, free. Same spreadsheet pipeline as Excel, with optional translation into 19 languages in one pass.",
    intro:
      "Raw CSV doesn't paste cleanly into docs, wikis, or LLM prompts. FileWorks parses CSV through the same spreadsheet pipeline as Excel and OpenDocument sheets, turning rows and columns into clean Markdown tables you can edit, translate, or automate over the API.",
    bullets: [
      "Parses comma- and common delimiter-separated CSV files",
      "Markdown table output, same pipeline as Excel and OpenDocument sheets",
      "Optional translation of cell text into 19 languages",
      "Automate with the Convert API for batch CSV-to-Markdown jobs",
    ],
    steps: [
      "Drop a CSV file into the FileWorks workspace.",
      "Optionally choose a translation language, then convert.",
      "Review the Markdown table, download it, or call the same path from a script.",
    ],
    useCases: [
      "Developers turning CSV exports into Markdown tables for docs or READMEs",
      "Analysts pasting CSV data into LLM prompts or RAG pipelines as structured tables",
      "Teams automating recurring CSV-to-Markdown jobs over the Convert API",
    ],
    apiExample: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  -F file=@data.csv \\
  -F target=markdown \\
  -F download=true \\
  -o data.md \\
  https://api.fileworks.ai/api/v1/convert`,
    comparisonIntro: "CSV looks simple until delimiters, quoting, or encoding don't match what a tool expects.",
    comparisonRows: [
      {
        aspect: "Delimiters",
        fileworks: "Common delimiter variants parsed through the same pipeline as Excel",
        typical: "Many tools assume comma-only and mis-split semicolon/tab files",
      },
      {
        aspect: "Large files",
        fileworks: "Up to 50 MB per file",
        typical: "Often capped much lower for plain-text tools",
      },
      {
        aspect: "Translation",
        fileworks: "Optional translation of cell text into 19 languages",
        typical: "Not offered",
      },
      {
        aspect: "Consistency with Excel",
        fileworks: "Same tabular pipeline as .xlsx/.ods, so output format matches",
        typical: "A separate tool from the Excel converter, with different output quirks",
      },
      {
        aspect: "Automation",
        fileworks: "Convert API for batch CSV-to-Markdown jobs",
        typical: "Manual upload only",
      },
    ],
    tips: [
      "If columns come out misaligned, double-check the CSV's actual delimiter (comma vs. semicolon vs. tab) — re-saving from the source spreadsheet as standard comma-separated usually fixes it.",
      "Very large CSVs (tens of thousands of rows) make unwieldy Markdown tables for a person to read — convert a filtered export instead if the result isn't going straight to a script.",
      "For recurring exports from the same system, the Convert API lets you automate the CSV-to-Markdown step as part of a pipeline instead of converting by hand each time.",
    ],
    faqs: [
      {
        question: "Is CSV to Markdown free on FileWorks?",
        answer: casualFreeTierFaqAnswer(),
      },
      {
        question: "Does CSV conversion use the same pipeline as Excel?",
        answer:
          "Yes. CSV, Excel (.xls/.xlsx), and OpenDocument spreadsheets (.ods) all convert through the same tabular pipeline into Markdown tables, with optional translation into 19 languages.",
      },
      {
        question: "Is there a file size limit for CSV to Markdown?",
        answer: "CSV files up to 50 MB are accepted, whether uploaded in the workspace or via the Convert API.",
      },
    ],
    related: [
      "excel-to-markdown",
      "pdf-to-markdown",
      "word-to-markdown",
      "powerpoint-to-markdown",
      "image-to-markdown",
      "epub-to-markdown",
    ],
    publishedDate: "2026-09-30",
  },
  {
    slug: "epub-to-markdown",
    path: "/epub-to-markdown",
    title: "EPUB to Markdown converter",
    headline: "Convert EPUB ebooks to Markdown — with translation",
    description:
      "Convert EPUB ebooks into editable Markdown online, free. Chapters and headings map to Markdown structure, with optional translation into 19 languages.",
    intro:
      "EPUB keeps chapter and reflow structure for e-readers, not for editing or quoting in notes. FileWorks converts EPUB into Markdown you can edit, search, translate into 19 languages, and feed into docs tools or LLM context.",
    bullets: [
      "Accepts standard .epub ebook files",
      "Chapter headings and text structure map to Markdown",
      "Optional translation into 19 languages in the same pass",
      "Download Markdown, TXT, HTML, or re-export via the Convert API",
    ],
    steps: [
      "Open the FileWorks workspace and drop an EPUB file.",
      "Optionally pick a translation language.",
      "Convert, then edit the Markdown chapters or download the result.",
    ],
    useCases: [
      "Readers and researchers pulling ebook excerpts into Markdown notes",
      "Developers and AI agents chunking ebook chapters for RAG ingestion",
      "Translating an EPUB book's text into another language in one pass",
    ],
    apiExample: `curl -s -H "Authorization: Bearer YOUR_API_KEY" \\
  -F file=@book.epub \\
  -F target=markdown \\
  -F download=true \\
  -o book.md \\
  https://api.fileworks.ai/api/v1/convert`,
    comparisonIntro: "Ebooks are built for reflowable reading, not editing — here's what usually gets lost elsewhere.",
    comparisonRows: [
      {
        aspect: "Chapter structure",
        fileworks: "Chapter headings map to Markdown heading levels",
        typical: "Often flattened into one long, untitled block of text",
      },
      {
        aspect: "Footnotes / endnotes",
        fileworks: "Kept inline near their reference where the EPUB structure supports it",
        typical: "Frequently dropped or separated from context",
      },
      {
        aspect: "Translation",
        fileworks: "Optional translation of the full book's text into 19 languages",
        typical: "Not offered",
      },
      {
        aspect: "Output options",
        fileworks: "Markdown, TXT, or HTML re-export",
        typical: "Usually plain text only",
      },
      {
        aspect: "File size",
        fileworks: "Up to 50 MB per EPUB",
        typical: "Often capped well below typical ebook sizes",
      },
    ],
    tips: [
      "If chapter breaks disappear in the output, check that the source EPUB actually uses heading tags for chapter titles — some poorly structured EPUBs rely on page breaks alone, which carry no heading information.",
      "For long books, convert and review one chapter's Markdown first before translating the whole file, since translation uses AI page credits or allowance.",
      "Image-heavy EPUBs (comics, illustrated books) convert the surrounding text well but won't meaningfully OCR embedded illustrations — this converter is for text-structured ebooks, not scanned picture books.",
    ],
    faqs: [
      {
        question: "Is EPUB to Markdown free on FileWorks?",
        answer: casualFreeTierFaqAnswer(),
      },
      {
        question: "Can I translate an EPUB while converting it to Markdown?",
        answer:
          "Yes. Set a target language alongside the EPUB upload and translation runs in the same conversion pass, sharing the workspace AI page allowance or Convert API AI credits.",
      },
      {
        question: "Is there a file size limit for EPUB to Markdown?",
        answer: "EPUB files up to 50 MB are accepted, whether uploaded in the workspace or via the Convert API.",
      },
    ],
    related: [
      "pdf-to-markdown",
      "word-to-markdown",
      "csv-to-markdown",
      "image-to-markdown",
      "excel-to-markdown",
      "powerpoint-to-markdown",
    ],
    publishedDate: "2026-09-30",
  },
];

export function guideBySlug(slug: string): ConvertGuide | undefined {
  return CONVERT_GUIDES.find((g) => g.slug === slug);
}

export function absoluteUrl(path = "/"): string {
  if (!path || path === "/") return SITE_URL;
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildPageMetadata(input: {
  title: string;
  description: string;
  path?: string;
  keywords?: readonly string[];
  noIndex?: boolean;
}): Metadata {
  const url = absoluteUrl(input.path || "/");
  const title = input.title.includes(BUSINESS_NAME) ? input.title : `${input.title} — ${BUSINESS_NAME}`;
  return {
    // absolute avoids the root layout `title.template` doubling the brand.
    title: { absolute: title },
    description: input.description,
    keywords: [...(input.keywords || PRIMARY_KEYWORDS)],
    alternates: { canonical: url },
    // Next.js metadata merging replaces `robots` wholesale rather than merging
    // with the root layout's googleBot snippet/preview directives, so restate
    // them here — otherwise every page silently loses large image/snippet previews.
    robots: input.noIndex
      ? { index: false, follow: false, googleBot: { index: false, follow: false } }
      : {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
            "max-video-preview": -1,
          },
        },
    openGraph: {
      type: "website",
      locale: "en_US",
      url,
      siteName: BUSINESS_NAME,
      title,
      description: input.description,
      images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: `${BUSINESS_NAME} — ${SITE_TAGLINE}` }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: input.description,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

export function faqJsonLd(faqs: FaqItem[]) {
  return {
    "@type": "FAQPage",
    "@id": `${SITE_URL}/#faq`,
    mainEntity: faqs.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function organizationJsonLd() {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: BUSINESS_NAME,
    legalName: LEGAL_ENTITY_NAME,
    alternateName: LEGAL_ENTITY_NAME,
    url: SITE_URL,
    email: SUPPORT_EMAIL,
    logo: {
      "@type": "ImageObject",
      url: LOGO_URL,
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: SUPPORT_EMAIL,
      url: absoluteUrl("/legal#contact"),
    },
  };
}

export function websiteJsonLd() {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    name: BUSINESS_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    publisher: { "@id": `${SITE_URL}/#organization` },
    inLanguage: "en-US",
  };
}

export function softwareApplicationJsonLd() {
  return {
    "@type": "WebApplication",
    "@id": `${SITE_URL}/#app`,
    name: BUSINESS_NAME,
    url: SITE_URL,
    applicationCategory: "BusinessApplication",
    applicationSubCategory: "DocumentConverter",
    operatingSystem: "Web browser",
    browserRequirements: "Requires JavaScript",
    description: SITE_DESCRIPTION,
    featureList: [
      "PDF to Markdown",
      "Word / Excel / PowerPoint to Markdown",
      "AI reading (OCR) for scanned PDFs and images",
      "Document translation into 19 languages",
      "AI + translation in the same conversion pass",
      "Fillable Designs (family schedules, invoices, agendas, plans)",
      "Edit text on PDFs and images",
      "Built-in Design starters API with variable params",
      "Convert API with long-lived keys",
      "Export Markdown, HTML, TXT, JSON, DOCX, and print PDF",
    ],
    offers: [
      {
        "@type": "Offer",
        name: "Casual",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: absoluteUrl("/pricing"),
        description: casualOfferDescription(),
      },
      {
        "@type": "Offer",
        name: "Daily",
        price: "5.00",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: absoluteUrl("/pricing"),
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "5.00",
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
      },
      {
        "@type": "Offer",
        name: "Expert",
        price: "29.00",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: absoluteUrl("/pricing"),
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "29.00",
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
      },
      {
        "@type": "Offer",
        name: "API Expert",
        price: "29.00",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: absoluteUrl("/pricing"),
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "29.00",
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
      },
    ],
    provider: { "@id": `${SITE_URL}/#organization` },
  };
}

export function breadcrumbJsonLd(items: Array<{ name: string; path: string }>) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function homeJsonLdGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [organizationJsonLd(), websiteJsonLd(), softwareApplicationJsonLd()],
  };
}

export function guideJsonLd(guide: ConvertGuide) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      organizationJsonLd(),
      {
        "@type": "WebPage",
        "@id": absoluteUrl(guide.path),
        url: absoluteUrl(guide.path),
        name: `${guide.title} — ${BUSINESS_NAME}`,
        description: guide.description,
        datePublished: guide.publishedDate,
        // Build-time timestamp, same freshness-signal approach as sitemap.ts.
        dateModified: new Date().toISOString(),
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#app` },
      },
      breadcrumbJsonLd([
        { name: BUSINESS_NAME, path: "/" },
        { name: guide.title, path: guide.path },
      ]),
      {
        ...faqJsonLd(guide.faqs),
        "@id": `${absoluteUrl(guide.path)}#faq`,
      },
      {
        "@type": "HowTo",
        name: guide.headline,
        description: guide.description,
        step: guide.steps.map((text, index) => ({
          "@type": "HowToStep",
          position: index + 1,
          text,
        })),
      },
    ],
  };
}

export const INDEXABLE_ROUTES: Array<{ path: string; changeFrequency: "weekly" | "monthly"; priority: number }> = [
  { path: "/", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", changeFrequency: "weekly", priority: 0.9 },
  { path: "/docs", changeFrequency: "weekly", priority: 0.9 },
  { path: "/templates", changeFrequency: "weekly", priority: 0.85 },
  { path: "/edit", changeFrequency: "weekly", priority: 0.85 },
  { path: "/about", changeFrequency: "monthly", priority: 0.8 },
  { path: "/legal", changeFrequency: "monthly", priority: 0.5 },
  ...CONVERT_GUIDES.map((guide) => ({
    path: guide.path,
    changeFrequency: "monthly" as const,
    priority: 0.85,
  })),
];

export { BUSINESS_NAME, LEGAL_ENTITY_NAME, SITE_HOST, SITE_URL, SUPPORT_EMAIL };
