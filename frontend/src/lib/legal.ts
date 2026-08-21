export const BUSINESS_NAME = "FileWorks";
export const SITE_HOST = "fileworks.ai";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://fileworks.ai").replace(/\/$/, "");
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || `support@${SITE_HOST}`;

export const LEGAL_UPDATED = "August 15, 2026";

export const MARKETING_LINKS = [
  { href: "/templates", label: "Designs" },
  { href: "/pricing", label: "Pricing" },
  { href: "/docs", label: "API" },
  { href: "/legal", label: "Legal" },
] as const;

export const GUIDE_LINKS = [
  { href: "/pdf-to-markdown", label: "PDF → Markdown (+ AI / translate)" },
  { href: "/word-to-markdown", label: "Word → Markdown (+ AI / translate)" },
  { href: "/excel-to-markdown", label: "Excel → Markdown (+ translate)" },
  { href: "/powerpoint-to-markdown", label: "PowerPoint → Markdown (+ AI / translate)" },
  { href: "/image-to-markdown", label: "Image OCR → Markdown (+ translate)" },
  { href: "/templates", label: "Fillable document designs" },
] as const;

export const LEGAL_LINKS = [
  { href: "/docs", label: "API" },
  { href: "/templates", label: "Designs" },
  { href: "/about", label: "About" },
  { href: "/pdf-to-markdown", label: "PDF to Markdown" },
  { href: "/legal#contact", label: "Contact" },
  { href: "/legal#refunds", label: "Refunds" },
  { href: "/legal#cancellation", label: "Cancellation" },
  { href: "/legal", label: "Legal" },
] as const;
