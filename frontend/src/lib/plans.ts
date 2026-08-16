export type PlanRule = {
  id: string;
  label: string;
  convert: string;
  quota: string;
  extras: string;
};

export const PLAN_RULES: PlanRule[] = [
  { id: "anonymous", label: "Guest", convert: "Sign in required", quota: "—", extras: "No history" },
  { id: "basic", label: "Basic", convert: "Yes", quota: "5 files / day", extras: "3 AI or translation / month" },
  { id: "pro", label: "Pro", convert: "Yes", quota: "150 / month", extras: "40 with AI or translation" },
  { id: "premium", label: "Premium", convert: "Yes", quota: "600 / month", extras: "150 with AI or translation" },
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
};

export const API_PLAN_CATALOG: ApiCatalogPlan[] = [
  {
    id: "api_free",
    label: "API Free",
    blurb: "Try the convert API with a long-lived key. Stacks with any workspace role.",
    price: "Free",
    quota: "100 credits / month",
    features: [
      "100 credits / month",
      "1 credit per page (3 with AI or translation)",
      "2 API keys that do not expire",
      "Combine with Basic, Pro, or Premium",
    ],
  },
  {
    id: "api_builder",
    label: "API Builder",
    blurb: "For scripts and light production volume.",
    price: "$19 / month",
    quota: "2,000 credits / month",
    features: [
      "2,000 credits / month",
      "1 credit per page (3 with AI or translation)",
      "5 API keys that do not expire",
      "Billed separately from workspace Pro / Premium",
    ],
  },
  {
    id: "api_scale",
    label: "API Scale",
    blurb: "Higher monthly page volume for product integrations.",
    price: "$49 / month",
    quota: "8,000 credits / month",
    features: [
      "8,000 credits / month",
      "1 credit per page (3 with AI or translation)",
      "10 API keys that do not expire",
      "Billed separately from workspace Pro / Premium",
    ],
    highlight: true,
  },
  {
    id: "api_business",
    label: "API Business",
    blurb: "Highest self-serve convert volume.",
    price: "$99 / month",
    quota: "20,000 credits / month",
    features: [
      "20,000 credits / month",
      "1 credit per page (3 with AI or translation)",
      "20 API keys that do not expire",
      "Billed separately from workspace Pro / Premium",
    ],
  },
];

export const API_PLAN_ORDER = ["api_free", "api_builder", "api_scale", "api_business"] as const;

export const API_PLAN_LIMITS: Record<string, { creditsPerMonth: number }> = {
  api_free: { creditsPerMonth: 100 },
  api_builder: { creditsPerMonth: 2000 },
  api_scale: { creditsPerMonth: 8000 },
  api_business: { creditsPerMonth: 20000 },
};

export const PLAN_CATALOG: CatalogPlan[] = [
  {
    id: "basic",
    label: "Basic",
    blurb: "Daily conversions. A small monthly AI and translation allowance.",
    price: "Free",
    quota: "5 files / day",
    features: [
      "5 conversions / day",
      "3 AI reading or translation / month",
      "Translate into 19 languages",
      "Unlimited downloads of each result",
      "Document history",
    ],
  },
  {
    id: "pro",
    label: "Pro",
    blurb: "Monthly volume for regular conversion, with AI reading and translation.",
    price: "$12 / month",
    quota: "150 files / month",
    features: [
      "Everything in Basic",
      "150 conversions / month (PDF, office, Markdown, TXT, images, scans)",
      "40 AI reading or translation",
      "Translate into 19 languages",
      "Unlimited downloads of each result",
    ],
  },
  {
    id: "premium",
    label: "Premium",
    blurb: "Highest single-seat volume, AI reading, and translation.",
    price: "$29 / month",
    quota: "600 files / month",
    features: [
      "Everything in Pro",
      "600 conversions / month",
      "150 AI reading or translation",
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
  },
  {
    id: "basic",
    role: "Basic",
    price: "Free",
    quota: "5 files / day",
    ai: "3 / month",
    history: "Unlimited downloads",
    blurb: "Signed-in starter role. Five conversions a day, with a small AI allowance.",
    features: PLAN_CATALOG[0].features,
    cta: { href: "/profile", label: "Get Basic" },
  },
  {
    id: "pro",
    role: "Pro",
    price: "$12 / month",
    quota: "150 files / month",
    ai: "40 with AI or translation",
    history: "Unlimited downloads",
    blurb: "Paid grade. Stripe assigns the Pro role after checkout.",
    features: PLAN_CATALOG[1].features,
    cta: { href: "/profile", label: "Choose Pro" },
    highlight: true,
  },
  {
    id: "premium",
    role: "Premium",
    price: "$29 / month",
    quota: "600 files / month",
    ai: "150 with AI or translation",
    history: "Unlimited downloads",
    blurb: "Highest single-seat grade. Stripe assigns the Premium role after checkout.",
    features: PLAN_CATALOG[2].features,
    cta: { href: "/profile", label: "Choose Premium" },
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
  basic: { extractsPerDay: 5, extractsPerMonth: null, aiPerDay: null, aiPerMonth: 3 },
  pro: { extractsPerDay: null, extractsPerMonth: 150, aiPerDay: null, aiPerMonth: 40 },
  premium: { extractsPerDay: null, extractsPerMonth: 600, aiPerDay: null, aiPerMonth: 150 },
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
    reasons.push(`${quota.used_ai_month} AI this month (limit ${limits.aiPerMonth})`);
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
};

export function apiUsageOverLimitReasons(quota: ApiUsageSnapshot | undefined, targetId: string): string[] {
  const limits = API_PLAN_LIMITS[targetId];
  if (!limits) return ["Unknown API plan"];
  const used = quota?.used_credits ?? 0;
  if (used > limits.creditsPerMonth) {
    return [`${used} API credits this month (limit ${limits.creditsPerMonth})`];
  }
  return [];
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
      return "Daily conversion limit reached";
    case "quota_month":
      return "Monthly conversion limit reached";
    case "quota_ai_day":
      return "Daily AI allowance reached";
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
      return "Conversion needs a signed-in FileWorks account. Guest browsing is fine; converting a file is not.";
    case "quota_day":
      return "Basic includes five conversions per day. Come back tomorrow, or upgrade for a monthly allowance.";
    case "quota_month":
      return "This account has used its monthly conversions. Upgrade or wait until next month.";
    case "quota_ai_day":
      return "Today’s AI or translation conversion is used. You can still convert without AI, or come back tomorrow.";
    case "quota_ai_month":
      return "This plan’s AI or translation allowance is used for the month. You can still convert files without AI, or upgrade.";
    case "plan":
      return "This account’s plan does not include file conversion.";
    default:
      return "FileWorks conversion follows the plan rules below.";
  }
}
