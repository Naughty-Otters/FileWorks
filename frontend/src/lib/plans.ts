export type PlanRule = {
  id: string;
  label: string;
  convert: string;
  quota: string;
  extras: string;
  price?: string;
  free?: boolean;
};

export const PLAN_RULES: PlanRule[] = [
  { id: "anonymous", label: "Guest", convert: "Sign in required", quota: "—", extras: "No history", price: "Free", free: true },
  { id: "basic", label: "Casual", convert: "Yes", quota: "30 files / day", extras: "25 AI pages / month", price: "Free", free: true },
  { id: "pro", label: "Daily", convert: "Yes", quota: "40 files / day", extras: "500 AI pages / month", price: "$5 / month" },
  { id: "premium", label: "Expert", convert: "Yes", quota: "200 files / day", extras: "5,000 AI pages / month", price: "$29 / month" },
];

export const PLAN_ORDER = ["anonymous", "basic", "pro", "premium"] as const;

export type CatalogPlan = {
  id: "basic" | "pro" | "premium";
  label: string;
  blurb: string;
  price: string;
  quota: string;
  features: string[];
};

export type ApiCatalogPlan = {
  id: "api_free" | "api_builder" | "api_scale" | "api_business";
  label: string;
  blurb: string;
  price: string;
  quota: string;
  features: string[];
  highlight?: boolean;
  /** Keep serving current subscribers; hide from pricing. */
  hidden?: boolean;
};

export const API_PLAN_CATALOG: ApiCatalogPlan[] = [
  {
    id: "api_free",
    label: "API Free",
    blurb: "Try the convert API with a long-lived key. Standard convert is free; AI uses page credits.",
    price: "Free",
    quota: "25 AI pages / month",
    features: [
      "1,000 standard pages / month (free)",
      "25 AI pages / month (1 credit per page)",
      "2 API keys that do not expire",
      "Combine with Casual, Daily, or Expert",
    ],
  },
  {
    id: "api_builder",
    label: "API Daily",
    blurb: "Personal scripts and light daily automation.",
    price: "$5 / month",
    quota: "500 AI pages / month",
    features: [
      "5,000 standard pages / month (free)",
      "500 AI pages / month",
      "5 API keys that do not expire",
      "Billed separately from workspace Daily / Expert",
    ],
  },
  {
    id: "api_scale",
    label: "API Expert",
    blurb: "Pipelines, inboxes, and product integrations.",
    price: "$29 / month",
    quota: "5,000 AI pages / month",
    features: [
      "20,000 standard pages / month (free)",
      "5,000 AI pages / month",
      "20 API keys that do not expire",
      "Billed separately from workspace Daily / Expert",
    ],
    highlight: true,
  },
  {
    id: "api_business",
    label: "API Business",
    blurb: "Legacy high-volume plan. Hidden from new checkout.",
    price: "$99 / month",
    quota: "10,000 AI pages / month",
    features: [
      "40,000 standard pages / month (free)",
      "10,000 AI pages / month",
      "20 API keys that do not expire",
      "Billed separately from workspace roles",
    ],
    hidden: true,
  },
];

export const PUBLIC_API_PLANS = API_PLAN_CATALOG.filter((plan) => !plan.hidden);

export const API_PLAN_ORDER = ["api_free", "api_builder", "api_scale", "api_business"] as const;

export const API_PLAN_LIMITS: Record<string, { creditsPerMonth: number; standardPagesPerMonth: number }> = {
  api_free: { creditsPerMonth: 25, standardPagesPerMonth: 1000 },
  api_builder: { creditsPerMonth: 500, standardPagesPerMonth: 5000 },
  api_scale: { creditsPerMonth: 5000, standardPagesPerMonth: 20000 },
  api_business: { creditsPerMonth: 10000, standardPagesPerMonth: 40000 },
};

export const PLAN_CATALOG: CatalogPlan[] = [
  {
    id: "basic",
    label: "Casual",
    blurb: "Use FileWorks for free. Convert is the product — no card.",
    price: "Free",
    quota: "30 files / day",
    features: [
      "30 conversions / day",
      "25 AI reading or translation pages / month",
      "Translate into 19 languages",
      "Unlimited downloads of each result",
      "Document history",
    ],
  },
  {
    id: "pro",
    label: "Daily",
    blurb: "For people who open FileWorks on workdays, including some AI.",
    price: "$5 / month",
    quota: "40 files / day",
    features: [
      "Everything in Casual",
      "40 conversions / day (PDF, office, Markdown, TXT, images, scans)",
      "500 AI reading or translation pages",
      "Translate into 19 languages",
      "Unlimited downloads of each result",
    ],
  },
  {
    id: "premium",
    label: "Expert",
    blurb: "Heavy and automated load. The plan we built for production volume.",
    price: "$29 / month",
    quota: "200 files / day",
    features: [
      "Everything in Daily",
      "200 conversions / day",
      "5,000 AI reading or translation pages",
      "Translate into 19 languages",
      "Unlimited downloads of each result",
    ],
  },
];

export type PriceRole = {
  id: string;
  role: string;
  price: string;
  quota: string;
  ai: string;
  history: string;
  blurb: string;
  features: string[];
  cta: { href: string; label: string };
  highlight?: boolean;
  /** Call out Free / no-card plans so they read first. */
  free?: boolean;
};

export const PRICE_ROLES: PriceRole[] = [
  {
    id: "anonymous",
    role: "Guest",
    price: "Free",
    quota: "None",
    ai: "No",
    history: "No",
    blurb: "Look around the workspace. Conversion needs a signed-in role.",
    features: ["Browse the app", "No file conversion", "No saved history"],
    cta: { href: "/", label: "Continue as guest" },
    free: true,
  },
  {
    id: "basic",
    role: "Casual",
    price: "Free",
    quota: "30 files / day",
    ai: "25 pages / month",
    history: "Unlimited downloads",
    blurb: "Stay here forever if you only convert. No credit card.",
    features: PLAN_CATALOG[0].features,
    cta: { href: "/login?next=%2Fpricing", label: "Start free with Casual" },
    free: true,
  },
  {
    id: "pro",
    role: "Daily",
    price: "$5 / month",
    quota: "40 files / day",
    ai: "500 AI pages / month",
    history: "Unlimited downloads",
    blurb: "Coffee-money plan when you use AI on workdays.",
    features: PLAN_CATALOG[1].features,
    cta: { href: "/profile", label: "Choose Daily" },
  },
  {
    id: "premium",
    role: "Expert",
    price: "$29 / month",
    quota: "200 files / day",
    ai: "5,000 AI pages / month",
    history: "Unlimited downloads",
    blurb: "Pipelines, inboxes, and volume AI. The plan we sell.",
    features: PLAN_CATALOG[2].features,
    cta: { href: "/profile", label: "Choose Expert" },
    highlight: true,
  },
];

export const PERMISSION_LABELS: Record<string, string> = {
  extract: "Convert files",
  "extract.full_result": "Full results",
  "extract.ai": "AI reading",
  "extract.translate": "Translation",
  "history.read": "History",
  export: "Export",
};

export function formatPlanPrice(amount: number | null | undefined): string {
  if (amount == null) return "—";
  if (amount <= 0) return "Free";
  return `$${amount} / month`;
}

export function planDisplayLabel(id: string | null | undefined): string {
  return PLAN_RULES.find((plan) => plan.id === id)?.label ?? id ?? "";
}

export function apiPlanDisplayLabel(id: string | null | undefined): string {
  return API_PLAN_CATALOG.find((plan) => plan.id === id)?.label ?? id ?? "";
}

export function planRank(id: string): number {
  const index = (PLAN_ORDER as readonly string[]).indexOf(id);
  return index < 0 ? 0 : index;
}

export function canSwitchPlan(current: string, target: string): boolean {
  return target !== current && PLAN_CATALOG.some((plan) => plan.id === target);
}

export type PlanLimits = {
  extractsPerDay: number | null;
  extractsPerMonth: number | null;
  aiPerDay: number | null;
  aiPerMonth: number | null;
};

export const PLAN_LIMITS: Record<string, PlanLimits> = {
  basic: { extractsPerDay: 30, extractsPerMonth: null, aiPerDay: null, aiPerMonth: 25 },
  pro: { extractsPerDay: 40, extractsPerMonth: null, aiPerDay: null, aiPerMonth: 500 },
  premium: { extractsPerDay: 200, extractsPerMonth: null, aiPerDay: null, aiPerMonth: 5000 },
};

export type UsageSnapshot = {
  used_day: number;
  used_month: number;
  used_ai_day: number;
  used_ai_month: number;
};

export function usageOverLimitReasons(quota: UsageSnapshot, targetId: string): string[] {
  const limits = PLAN_LIMITS[targetId];
  if (!limits) return ["Unknown plan"];
  const reasons: string[] = [];
  if (limits.extractsPerDay != null && quota.used_day > limits.extractsPerDay) {
    reasons.push(`${quota.used_day} conversions today (limit ${limits.extractsPerDay})`);
  }
  if (limits.extractsPerMonth != null && quota.used_month > limits.extractsPerMonth) {
    reasons.push(`${quota.used_month} conversions this month (limit ${limits.extractsPerMonth})`);
  }
  if (limits.aiPerDay != null && quota.used_ai_day > limits.aiPerDay) {
    reasons.push(`${quota.used_ai_day} AI today (limit ${limits.aiPerDay})`);
  }
  if (limits.aiPerMonth != null && quota.used_ai_month > limits.aiPerMonth) {
    reasons.push(`${quota.used_ai_month} AI pages this month (limit ${limits.aiPerMonth})`);
  }
  return reasons;
}

export function usageFitsPlan(quota: UsageSnapshot, targetId: string): boolean {
  return usageOverLimitReasons(quota, targetId).length === 0;
}

export function canMoveToPlan(current: string, target: string, quota: UsageSnapshot): boolean {
  if (!canSwitchPlan(current, target)) return false;
  if (planRank(target) >= planRank(current)) return true;
  return usageFitsPlan(quota, target);
}

export function planIsPurchasable(
  planId: string,
  billing?: {
    enabled?: boolean;
    prices?: Record<string, boolean>;
    amounts?: Record<string, number>;
  } | null,
): boolean {
  if (!billing?.enabled) return true;
  if (billing.prices?.[planId]) return true;
  return (billing.amounts?.[planId] ?? 0) > 0;
}

export function apiPlanRank(id: string): number {
  const index = (API_PLAN_ORDER as readonly string[]).indexOf(id as (typeof API_PLAN_ORDER)[number]);
  return index < 0 ? 0 : index;
}

export function canSwitchApiPlan(current: string, target: string): boolean {
  return target !== current && API_PLAN_CATALOG.some((plan) => plan.id === target);
}

export type ApiUsageSnapshot = {
  used_credits: number;
  limit_credits: number | null;
  remaining_credits: number | null;
  used_standard_pages?: number;
  limit_standard_pages?: number | null;
  remaining_standard_pages?: number | null;
};

export function apiUsageOverLimitReasons(quota: ApiUsageSnapshot | undefined, targetId: string): string[] {
  const limits = API_PLAN_LIMITS[targetId];
  if (!limits) return ["Unknown API plan"];
  const reasons: string[] = [];
  const used = quota?.used_credits ?? 0;
  if (used > limits.creditsPerMonth) {
    reasons.push(`${used} API AI pages this month (limit ${limits.creditsPerMonth})`);
  }
  const usedStandard = quota?.used_standard_pages ?? 0;
  if (usedStandard > limits.standardPagesPerMonth) {
    reasons.push(`${usedStandard} standard API pages this month (limit ${limits.standardPagesPerMonth})`);
  }
  return reasons;
}

export function canMoveToApiPlan(
  current: string,
  target: string,
  quota?: ApiUsageSnapshot,
): boolean {
  if (!canSwitchApiPlan(current, target)) return false;
  if (apiPlanRank(target) >= apiPlanRank(current)) return true;
  return apiUsageOverLimitReasons(quota, target).length === 0;
}

export function apiPlanSwitchLabel(current: string, target: ApiCatalogPlan): string {
  if (apiPlanRank(target.id) > apiPlanRank(current)) return `Upgrade to ${target.label}`;
  return `Switch to ${target.label}`;
}

export function planSwitchLabel(current: string, target: CatalogPlan): string {
  if (planRank(target.id) > planRank(current)) return `Upgrade to ${target.label}`;
  return `Switch to ${target.label}`;
}

export type ConvertGate = "login" | "plan" | "quota_day" | "quota_month" | "quota_ai_day" | "quota_ai_month" | "ready";

export function convertGate(args: {
  signedIn: boolean;
  canExtract: boolean;
  quotaBlocked?: boolean;
  remainingDay: number | null | undefined;
  remainingMonth: number | null | undefined;
  wantsAi?: boolean;
  remainingAiDay?: number | null | undefined;
  remainingAiMonth?: number | null | undefined;
}): ConvertGate {
  if (!args.signedIn) return "login";
  if (args.quotaBlocked && args.remainingDay === 0) return "quota_day";
  if (args.quotaBlocked && args.remainingMonth === 0) return "quota_month";
  if (args.remainingDay === 0) return "quota_day";
  if (args.remainingMonth === 0) return "quota_month";
  if (args.wantsAi && args.remainingAiDay === 0) return "quota_ai_day";
  if (args.wantsAi && args.remainingAiMonth === 0) return "quota_ai_month";
  if (!args.canExtract) return "plan";
  return "ready";
}

export function aiQuotaLeft(quota: {
  remaining_ai_day?: number | null;
  remaining_ai_month?: number | null;
} | null | undefined): boolean {
  if (!quota) return true;
  if (quota.remaining_ai_day === 0 || quota.remaining_ai_month === 0) return false;
  return true;
}

export function convertGateTitle(gate: ConvertGate): string {
  switch (gate) {
    case "login":
      return "Sign in to convert";
    case "quota_day":
      return "Today's conversion limit reached";
    case "quota_month":
      return "Monthly conversion limit reached";
    case "quota_ai_day":
      return "Today's AI allowance reached";
    case "quota_ai_month":
      return "Monthly AI allowance reached";
    case "plan":
      return "Your plan cannot convert files";
    default:
      return "Plan rules";
  }
}

export function convertGateBody(gate: ConvertGate): string {
  switch (gate) {
    case "login":
      return "Sign in once and you start on Free Casual — thirty conversions a day and 25 AI pages a month. No credit card. Guest browsing is fine; converting a file needs an account.";
    case "quota_day":
      return "This role’s daily conversion allowance is used. Come back tomorrow, or upgrade if you need more volume.";
    case "quota_month":
      return "This account has used its monthly conversions. Upgrade or wait until next month.";
    case "quota_ai_day":
      return "Today’s AI or translation pages are used. You can still convert without AI, or come back tomorrow.";
    case "quota_ai_month":
      return "This plan’s AI or translation page allowance is used for the month. You can still convert files without AI, or upgrade.";
    case "plan":
      return "This account’s plan does not include file conversion.";
    default:
      return "FileWorks conversion follows the plan rules below.";
  }
}
