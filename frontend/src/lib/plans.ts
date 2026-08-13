export type PlanRule = {
  id: string;
  label: string;
  convert: string;
  quota: string;
  extras: string;
};

export const PLAN_RULES: PlanRule[] = [
  { id: "anonymous", label: "Guest", convert: "Sign in required", quota: "—", extras: "No history" },
  { id: "basic", label: "Basic", convert: "Yes", quota: "1 file / day", extras: "History; no AI" },
  { id: "pro", label: "Pro", convert: "Yes", quota: "500 / month", extras: "AI + translation" },
  { id: "premium", label: "Premium", convert: "Yes", quota: "1000 / month", extras: "AI + translation" },
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
    blurb: "Convert files and keep history.",
    quota: "1 file / day",
    features: ["Full conversion results", "Document history", "Export Markdown / PDF"],
  },
  {
    id: "pro",
    label: "Pro",
    blurb: "AI reading and translation for daily work.",
    quota: "500 files / month",
    features: ["Everything in Basic", "AI reading", "Translation"],
  },
  {
    id: "premium",
    label: "Premium",
    blurb: "Higher monthly volume for teams.",
    quota: "1000 files / month",
    features: ["Everything in Pro", "1000 conversions / month"],
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

export type ConvertGate = "login" | "plan" | "quota_day" | "quota_month" | "ready";

export function convertGate(args: {
  signedIn: boolean;
  canExtract: boolean;
  quotaBlocked?: boolean;
  remainingDay: number | null | undefined;
  remainingMonth: number | null | undefined;
}): ConvertGate {
  if (!args.signedIn) return "login";
  if (args.quotaBlocked && args.remainingDay === 0) return "quota_day";
  if (args.quotaBlocked && args.remainingMonth === 0) return "quota_month";
  if (args.remainingDay === 0) return "quota_day";
  if (args.remainingMonth === 0) return "quota_month";
  if (!args.canExtract) return "plan";
  return "ready";
}

export function convertGateTitle(gate: ConvertGate): string {
  switch (gate) {
    case "login":
      return "Sign in to convert";
    case "quota_day":
      return "Daily conversion limit reached";
    case "quota_month":
      return "Monthly conversion limit reached";
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
      return "Basic includes one conversion per day. Come back tomorrow, or upgrade for a monthly allowance.";
    case "quota_month":
      return "This account has used its monthly conversions. Upgrade or wait until next month.";
    case "plan":
      return "This account’s plan does not include file conversion.";
    default:
      return "FileWorks conversion follows the plan rules below.";
  }
}
