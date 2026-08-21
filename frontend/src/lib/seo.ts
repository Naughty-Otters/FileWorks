import type { Metadata } from "next";
import { BUSINESS_NAME, SITE_HOST, SITE_URL, SUPPORT_EMAIL } from "@/lib/legal";

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
  "Convert PDF, Word, Excel, PowerPoint, images, and scanned documents into editable Markdown online. Optional AI reading for OCR on scans, translation into 19 languages, and fillable Designs (family schedules, invoices, agendas, and more) filled from the converted text. Workspace plans from free Basic; Convert API from free with page credits.";

export const SITE_TAGLINE = "PDF & Office → Markdown, Designs, AI reading & translation";

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
      "Yes. Enable AI reading for image-only PDFs, phone photos of pages, and other scans. AI reading uses page credits on the Convert API (3 credits per page) or your workspace AI allowance.",
  },
  {
    question: "Is there a PDF to Markdown API?",
    answer:
      "Yes. POST multipart files to /api/v1/convert with a long-lived fw_live_ API key. Examples for curl, Python, and JavaScript are on the API docs. API Free includes 100 page credits per month; paid API plans start at $19/month.",
  },
  {
    question: "Does FileWorks translate documents?",
    answer:
      "Yes. Optionally translate into 19 languages in the same conversion pass as PDF or office extraction. Translation shares the AI / translation allowance on workspace plans and uses enhanced page credits on the Convert API.",
  },
  {
    question: "Can I turn converted Markdown into invoices, schedules, or agendas?",
    answer:
      "Yes. Choose a Design in the workspace (family daily/weekly/monthly/yearly schedules, invoices, receipts, meeting agendas, project plans, task lists, timesheets, and more). FileWorks AI-fills the Design placeholders from the extracted Markdown. Via Convert API, pass design=invoice (or another starter id) on POST /api/v1/convert.",
  },
  {
    question: "How much does FileWorks cost?",
    answer:
      "Workspace Basic is free (5 conversions/day). Pro is $12/month (150 files) and Premium is $29/month (600 files). Convert API Free is free (100 credits/month); Builder $19, Scale $49, and Business $99. You can hold a workspace role and an API plan together.",
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
      "Workspace roles (Basic, Pro, Premium) cover the FileWorks web app: file quotas, AI reading, translation, history, and downloads. Convert API plans bill page credits and API keys separately for scripts and integrations. Both can be active on one account.",
  },
  {
    question: "How do Convert API page credits work?",
    answer:
      "Standard conversion costs 1 credit per page. AI reading or translation costs 3 credits per page. Unused monthly credits reset with the billing period; keys do not expire.",
  },
  {
    question: "Can I cancel or get a refund?",
    answer:
      "Yes. Cancel anytime from Stripe Customer Portal or Profile. Refund and dispute rules are published on the Legal page. Contact support@fileworks.ai for billing help.",
  },
  {
    question: "Do I need to pay to try PDF to Markdown?",
    answer:
      "No. Sign in for free Basic (5 conversions per day and a small AI allowance). API Free adds 100 page credits per month for programmatic convert calls.",
  },
];

export type ConvertGuide = {
  slug: string;
  path: string;
  title: string;
  headline: string;
  description: string;
  intro: string;
  bullets: string[];
  steps: string[];
  faqs: FaqItem[];
  related: string[];
};

export const CONVERT_GUIDES: ConvertGuide[] = [
  {
    slug: "pdf-to-markdown",
    path: "/pdf-to-markdown",
    title: "PDF to Markdown with AI & translation",
    headline: "Convert PDF to Markdown — AI reading & translation",
    description:
      "Turn PDFs into editable Markdown online. Optional AI reading for scanned/OCR pages and translation into 19 languages in the same pass. Free Basic plan at fileworks.ai.",
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
    faqs: [
      {
        question: "Is PDF to Markdown free on FileWorks?",
        answer:
          "Yes on Basic: five conversions per day after you sign in, plus a small AI / translation allowance. Guest browsing does not convert files. Paid Pro and Premium raise monthly volume and AI allowances.",
      },
      {
        question: "Can I OCR and translate a PDF in one step?",
        answer:
          "Yes. Enable AI reading for image-only or poorly selectable PDFs, and set a translation language. Both share the workspace AI / translation allowance, or Convert API enhanced credits (3 per page).",
      },
    ],
    related: ["word-to-markdown", "image-to-markdown", "excel-to-markdown"],
  },
  {
    slug: "word-to-markdown",
    path: "/word-to-markdown",
    title: "Word to Markdown with AI & translation",
    headline: "Convert Word (DOCX) to Markdown — translate too",
    description:
      "Convert Microsoft Word .doc and .docx to editable Markdown online. Optional AI cleanup for hard pages and translation into 19 languages. Free Basic plan available.",
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
    faqs: [
      {
        question: "Can I convert and translate DOCX with an API?",
        answer:
          "Yes. Use POST /api/v1/convert with target=markdown, optional use_ai=true, and target_lang. Auth with a fw_live_ API key. See the API docs for curl, Python, and JavaScript examples.",
      },
    ],
    related: ["pdf-to-markdown", "powerpoint-to-markdown", "excel-to-markdown"],
  },
  {
    slug: "excel-to-markdown",
    path: "/excel-to-markdown",
    title: "Excel to Markdown with translation",
    headline: "Convert Excel to Markdown tables — with translation",
    description:
      "Convert Excel .xls and .xlsx into Markdown tables online. Optionally translate sheet text into 19 languages. Useful for reports, docs, and LLM context. Free Basic plan.",
    intro:
      "Spreadsheets do not paste cleanly into notes or prompts. FileWorks turns Excel workbooks into Markdown you can edit, share, or send to an API — and optionally translate cell text into 19 languages in the same pass. CSV and OpenDocument spreadsheets are supported too.",
    bullets: [
      "Accepts .xls, .xlsx, .ods, and CSV",
      "Markdown table-oriented output for structured sheets",
      "Optional translation into 19 languages",
      "Automate with the Convert API (AI / translation use enhanced page credits)",
    ],
    steps: [
      "Drop an Excel or CSV file into the workspace.",
      "Optionally choose a translation language, then convert.",
      "Inspect tables in Markdown preview, download, or call the same path from scripts.",
    ],
    faqs: [
      {
        question: "Does Excel to Markdown keep multiple sheets?",
        answer:
          "FileWorks extracts spreadsheet content into Markdown suitable for reading and editing. For large multi-sheet books, convert focused ranges or use the API in a loop over exports. Translation applies to extracted text in the same pass.",
      },
    ],
    related: ["word-to-markdown", "pdf-to-markdown", "powerpoint-to-markdown"],
  },
  {
    slug: "powerpoint-to-markdown",
    path: "/powerpoint-to-markdown",
    title: "PowerPoint to Markdown with AI & translation",
    headline: "Convert PowerPoint to Markdown — AI & translation",
    description:
      "Convert PowerPoint .ppt and .pptx into editable Markdown online. AI reading for image-heavy slides and translation into 19 languages. Free Basic plan available.",
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
    faqs: [
      {
        question: "Can I convert and translate PPTX for RAG ingestion?",
        answer:
          "Yes. Markdown with clear structure chunks more reliably than binary PPTX. Use AI reading for image-heavy decks and target_lang for translation, in the web app or via the Convert API.",
      },
    ],
    related: ["pdf-to-markdown", "word-to-markdown", "image-to-markdown"],
  },
  {
    slug: "image-to-markdown",
    path: "/image-to-markdown",
    title: "Image OCR to Markdown with AI & translation",
    headline: "AI OCR images & scans to Markdown — translate too",
    description:
      "Convert PNG, JPEG, WebP, TIFF photos and scanned pages into editable Markdown with AI reading, then optionally translate into 19 languages. Online document OCR at fileworks.ai.",
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
    faqs: [
      {
        question: "Is AI OCR and translation included on the free plan?",
        answer:
          "Basic includes a small monthly AI / translation allowance (3 uses). Pro and Premium raise that allowance. Convert API charges 3 credits per page when AI reading or translation is on.",
      },
    ],
    related: ["pdf-to-markdown", "word-to-markdown", "powerpoint-to-markdown"],
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
    robots: input.noIndex
      ? { index: false, follow: false, googleBot: { index: false, follow: false } }
      : { index: true, follow: true },
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
      "Built-in Design starters API with variable params",
      "Convert API with long-lived keys",
      "Export Markdown, HTML, TXT, JSON, DOCX, and print PDF",
    ],
    offers: [
      {
        "@type": "Offer",
        name: "Basic",
        price: "0",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: absoluteUrl("/pricing"),
        description: "5 conversions per day with a small AI / translation allowance",
      },
      {
        "@type": "Offer",
        name: "Pro",
        price: "12.00",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: absoluteUrl("/pricing"),
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "12.00",
          priceCurrency: "USD",
          billingDuration: "P1M",
        },
      },
      {
        "@type": "Offer",
        name: "Premium",
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
        name: "API Builder",
        price: "19.00",
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
        url: absoluteUrl("/pricing"),
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: "19.00",
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
  { path: "/about", changeFrequency: "monthly", priority: 0.8 },
  { path: "/legal", changeFrequency: "monthly", priority: 0.5 },
  ...CONVERT_GUIDES.map((guide) => ({
    path: guide.path,
    changeFrequency: "monthly" as const,
    priority: 0.85,
  })),
];

export { BUSINESS_NAME, SITE_HOST, SITE_URL, SUPPORT_EMAIL };
