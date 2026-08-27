/**
 * Single source of truth for workspace + Convert API quotas and list prices.
 * Marketing copy, PLAN_* catalogs, SEO, and client-side limit checks derive from here.
 * Backend enforcement lives in backend/app/auth/plans.py and api_plans.py — keep numbers in sync.
 */

export type WorkspaceQuota = {
  id: "anonymous" | "basic" | "pro" | "premium";
  label: string;
  priceUsd: number | null; // null = not sold / N/A
  extractsPerDay: number | null;
  extractsPerMonth: number | null;
  aiPerDay: number | null;
  aiPerMonth: number | null;
};

export type ApiQuota = {
  id: "api_free" | "api_builder" | "api_scale" | "api_business";
  label: string;
  priceUsd: number;
  creditsPerMonth: number;
  standardPagesPerMonth: number;
  maxKeys: number;
  hidden?: boolean;
};

export const WORKSPACE_QUOTAS: Record<WorkspaceQuota["id"], WorkspaceQuota> = {
  anonymous: {
    id: "anonymous",
    label: "Guest",
    priceUsd: 0,
    extractsPerDay: null,
    extractsPerMonth: null,
    aiPerDay: null,
    aiPerMonth: null,
  },
  basic: {
    id: "basic",
    label: "Casual",
    priceUsd: 0,
    extractsPerDay: 30,
    extractsPerMonth: null,
    aiPerDay: null,
    aiPerMonth: 5,
  },
  pro: {
    id: "pro",
    label: "Daily",
    priceUsd: 5,
    extractsPerDay: 40,
    extractsPerMonth: null,
    aiPerDay: null,
    aiPerMonth: 100,
  },
  premium: {
    id: "premium",
    label: "Expert",
    priceUsd: 29,
    extractsPerDay: 200,
    extractsPerMonth: null,
    aiPerDay: null,
    aiPerMonth: 1000,
  },
};

export const API_QUOTAS: Record<ApiQuota["id"], ApiQuota> = {
  api_free: {
    id: "api_free",
    label: "API Free",
    priceUsd: 0,
    creditsPerMonth: 5,
    standardPagesPerMonth: 1000,
    maxKeys: 2,
  },
  api_builder: {
    id: "api_builder",
    label: "API Daily",
    priceUsd: 5,
    creditsPerMonth: 100,
    standardPagesPerMonth: 5000,
    maxKeys: 5,
  },
  api_scale: {
    id: "api_scale",
    label: "API Expert",
    priceUsd: 29,
    creditsPerMonth: 1000,
    standardPagesPerMonth: 20000,
    maxKeys: 20,
  },
  api_business: {
    id: "api_business",
    label: "API Business",
    priceUsd: 99,
    creditsPerMonth: 2000,
    standardPagesPerMonth: 40000,
    maxKeys: 20,
    hidden: true,
  },
};

export const CASUAL = WORKSPACE_QUOTAS.basic;
export const DAILY = WORKSPACE_QUOTAS.pro;
export const EXPERT = WORKSPACE_QUOTAS.premium;
export const API_FREE = API_QUOTAS.api_free;
export const API_DAILY = API_QUOTAS.api_builder;
export const API_EXPERT = API_QUOTAS.api_scale;

/** Locale-independent thousands separators for marketing copy. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatUsdMonth(amount: number | null | undefined): string {
  if (amount == null) return "—";
  if (amount <= 0) return "Free";
  return `$${amount} / month`;
}

export function filesPerDayLabel(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${formatCount(n)} files / day`;
}

export function conversionsPerDayLabel(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${formatCount(n)} conversions / day`;
}

export function aiPagesMonthLabel(n: number | null | undefined, opts?: { prefix?: string; short?: boolean }): string {
  if (n == null) return "—";
  const prefix = opts?.prefix ?? "AI";
  if (opts?.short) return `${formatCount(n)} pages / month`;
  return `${formatCount(n)} ${prefix} pages / month`;
}

export function standardPagesMonthLabel(n: number): string {
  return `${formatCount(n)} standard pages / month (free)`;
}

/** Short signup / gate copy for Free Casual. */
export function casualSignupSentence(): string {
  return `Sign in once and you start on Free Casual — ${formatCount(CASUAL.extractsPerDay!)} conversions a day and ${formatCount(CASUAL.aiPerMonth!)} AI pages a month. No credit card. Guest browsing is fine; converting a file needs an account.`;
}

export function casualLoginBlurb(): string {
  return `Sign in and you start on Free Casual — ${formatCount(CASUAL.extractsPerDay!)} conversions a day and ${formatCount(CASUAL.aiPerMonth!)} AI pages a month. No credit card. Daily is $${DAILY.priceUsd} when you use AI every workday. Expert is $${EXPERT.priceUsd} for volume.`;
}

export function apiFreeQuotaSentence(): string {
  return `${formatCount(API_FREE.standardPagesPerMonth)} standard pages and ${formatCount(API_FREE.creditsPerMonth)} AI pages / month`;
}

export function pricingCostFaqAnswer(): string {
  return `Workspace Casual is free (${formatCount(CASUAL.extractsPerDay!)} conversions/day). Daily is $${DAILY.priceUsd}/month (${formatCount(DAILY.aiPerMonth!)} AI pages) and Expert is $${EXPERT.priceUsd}/month (${formatCount(EXPERT.aiPerMonth!)} AI pages). Convert is included; you pay for AI pages. Convert API Free is free; API Daily $${API_DAILY.priceUsd} and API Expert $${API_EXPERT.priceUsd}. You can hold a workspace role and an API plan together.`;
}

export function apiDocsFaqAnswer(): string {
  return `Yes. POST multipart files to /api/v1/convert with a long-lived fw_live_ API key. Examples for curl, Python, and JavaScript are on the API docs. API Free includes ${apiFreeQuotaSentence()}; paid API plans start at $${API_DAILY.priceUsd}/month.`;
}

export function freeCasualCardFaqAnswer(): string {
  return `No. Sign in for free Casual (${formatCount(CASUAL.extractsPerDay!)} conversions per day and ${formatCount(CASUAL.aiPerMonth!)} AI pages). API Free adds ${apiFreeQuotaSentence()} for programmatic convert calls.`;
}

export function casualFreeTierFaqAnswer(): string {
  return `Yes on Casual: ${formatCount(CASUAL.extractsPerDay!)} conversions per day after you sign in, plus ${formatCount(CASUAL.aiPerMonth!)} AI pages a month. Guest browsing does not convert files. Daily ($${DAILY.priceUsd}) and Expert ($${EXPERT.priceUsd}) raise AI page allowances.`;
}

export function casualAiAllowanceFaqAnswer(): string {
  return `Casual includes ${formatCount(CASUAL.aiPerMonth!)} AI / translation pages per month. Daily and Expert raise that allowance. Convert API charges 1 credit per page when AI reading or translation is on. Standard convert does not use AI credits.`;
}

export function casualOfferDescription(): string {
  return `${formatCount(CASUAL.extractsPerDay!)} conversions per day with ${formatCount(CASUAL.aiPerMonth!)} AI / translation pages per month`;
}

export function checkoutCanceledNotice(): string {
  return `Checkout canceled — no charge. You can keep using Free Casual (${conversionsPerDayLabel(CASUAL.extractsPerDay)}) or pick Daily or Expert when you are ready.`;
}

export function pricingPageDescription(): string {
  return `FileWorks pricing: free Casual workspace (${formatCount(CASUAL.extractsPerDay!)} conversions/day), Daily $${DAILY.priceUsd}/mo, Expert $${EXPERT.priceUsd}/mo. Convert is free; pay for AI pages. Convert API Free, Daily $${API_DAILY.priceUsd}, Expert $${API_EXPERT.priceUsd}.`;
}

export function casualConvertTeaser(): string {
  return `(${conversionsPerDayLabel(CASUAL.extractsPerDay)}, no credit card)`;
}
