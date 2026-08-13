export type PlanRule = {
  id: string;
  label: string;
  convert: string;
  quota: string;
  extras: string;
};

export const PLAN_RULES: PlanRule[] = [
  { id: "anonymous", label: "Guest", convert: "Sign in required", quota: "—", extras: "No history" },
  { id: "basic", label: "Basic", convert: "Yes", quota: "1 file / day", extras: "AI + translation on that file" },
  { id: "pro", label: "Pro", convert: "Yes", quota: "100 / month", extras: "50 with AI or translation" },
  { id: "premium", label: "Premium", convert: "Yes", quota: "500 / month", extras: "100 with AI or translation" },
];

export const PLAN_ORDER = ["anonymous", "basic", "pro", "premium"] as const;

export type CatalogPlan = {
  id: "basic" | "pro" | "premium";
  label: string;
  blurb: string;
  quota: string;
  features: string[];
};

export const PLAN_CATALOG: CatalogPlan[] = [
  {
    id: "basic",
    label: "Basic",
    blurb: "One conversion per day, including AI and translation.",
    quota: "1 file / day",
    features: ["Full conversion results", "AI reading and translation", "Document history"],
  },
  {
    id: "pro",
    label: "Pro",
    blurb: "Higher volume, with a monthly AI and translation cap.",
    quota: "100 files / month",
    features: ["Everything in Basic", "100 conversions / month", "50 with AI or translation"],
  },
  {
    id: "premium",
    label: "Premium",
    blurb: "Highest monthly volume for teams.",
    quota: "500 files / month",
    features: ["Everything in Pro", "500 conversions / month", "100 with AI or translation"],
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

export function planRank(id: string): number {
  const index = (PLAN_ORDER as readonly string[]).indexOf(id);
  return index < 0 ? 0 : index;
}

export function canSwitchPlan(current: string, target: string): boolean {
  return target !== current && PLAN_CATALOG.some((plan) => plan.id === target);
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
      return "Basic includes one conversion per day, with AI and translation. Come back tomorrow, or upgrade for a monthly allowance.";
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
