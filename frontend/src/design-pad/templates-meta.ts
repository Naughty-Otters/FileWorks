import type { DesignDocument } from "./types";

/** Starter taxonomy aligned with common business document libraries. */
export type TemplateCategory =
  | "family"
  | "business"
  | "agreements"
  | "plans"
  | "policies"
  | "forms"
  | "checklists"
  | "letters"
  | "proposals"
  | "reports"
  | "notices"
  | "memos"
  | "press";

export interface Template {
  id: string;
  label: string;
  description: string;
  category: TemplateCategory;
  build: () => DesignDocument;
}

export const TEMPLATE_CATEGORIES: { id: TemplateCategory; label: string; blurb: string }[] = [
  { id: "family", label: "Family", blurb: "Schedules and planners for the household" },
  {
    id: "business",
    label: "Business",
    blurb: "Invoices, meetings, tasks, timesheets, and day-to-day ops docs",
  },
  {
    id: "agreements",
    label: "Agreements",
    blurb: "NDAs, service and employment contracts, board resolutions",
  },
  {
    id: "plans",
    label: "Plans",
    blurb: "Business, marketing, and cash-flow planning sheets",
  },
  {
    id: "policies",
    label: "Policies",
    blurb: "Leave, remote work, and workplace policy pages",
  },
  {
    id: "forms",
    label: "Forms",
    blurb: "Purchase orders, job descriptions, and fillable forms",
  },
  {
    id: "checklists",
    label: "Checklists",
    blurb: "New-hire and project launch checklists",
  },
  {
    id: "letters",
    label: "Letters",
    blurb: "Offer letters, resignation letters, and correspondence",
  },
  {
    id: "proposals",
    label: "Proposals",
    blurb: "Business and consulting proposals with phases and fees",
  },
  {
    id: "reports",
    label: "Reports",
    blurb: "Status reports, P&L, and extracted Markdown reports",
  },
  {
    id: "notices",
    label: "Notices",
    blurb: "Cancellation and formal notices",
  },
  {
    id: "memos",
    label: "Memos",
    blurb: "Internal memos with clear actions",
  },
  {
    id: "press",
    label: "Press",
    blurb: "Press releases with quote and boilerplate",
  },
];
