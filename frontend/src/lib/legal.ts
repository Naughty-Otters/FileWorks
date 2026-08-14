export const BUSINESS_NAME = "FileWorks";
export const SITE_HOST = "fileworks.ai";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://fileworks.ai").replace(/\/$/, "");
export const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL || `support@${SITE_HOST}`;

export const LEGAL_UPDATED = "August 13, 2026";

export const MARKETING_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/legal", label: "Legal" },
] as const;

export const LEGAL_LINKS = [
  { href: "/about", label: "About" },
  { href: "/legal#contact", label: "Contact" },
  { href: "/legal#refunds", label: "Refunds" },
  { href: "/legal#cancellation", label: "Cancellation" },
  { href: "/legal", label: "Legal" },
] as const;
