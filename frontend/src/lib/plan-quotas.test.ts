import { describe, expect, it } from "vitest";
import {
  API_QUOTAS,
  CASUAL,
  DAILY,
  EXPERT,
  WORKSPACE_QUOTAS,
  aiPagesMonthLabel,
  formatCount,
} from "@/lib/plan-quotas";
import { API_PLAN_CATALOG, API_PLAN_LIMITS, PLAN_CATALOG, PLAN_LIMITS, PLAN_RULES, PRICE_ROLES } from "@/lib/plans";

describe("plan-quotas", () => {
  it("is the only numeric source for workspace catalogs and limits", () => {
    expect(PLAN_LIMITS.basic.aiPerMonth).toBe(CASUAL.aiPerMonth);
    expect(PLAN_LIMITS.pro.aiPerMonth).toBe(DAILY.aiPerMonth);
    expect(PLAN_LIMITS.premium.aiPerMonth).toBe(EXPERT.aiPerMonth);
    expect(PLAN_LIMITS.basic.extractsPerDay).toBe(CASUAL.extractsPerDay);
    expect(PLAN_LIMITS.pro.extractsPerDay).toBe(DAILY.extractsPerDay);
    expect(PLAN_LIMITS.premium.extractsPerDay).toBe(EXPERT.extractsPerDay);

    for (const plan of PLAN_CATALOG) {
      const q = WORKSPACE_QUOTAS[plan.id];
      expect(plan.quota).toContain(formatCount(q.extractsPerDay!));
      expect(plan.features.some((f) => f.includes(formatCount(q.aiPerMonth!)))).toBe(true);
    }

    expect(PLAN_RULES.find((p) => p.id === "pro")?.extras).toBe(aiPagesMonthLabel(DAILY.aiPerMonth));
    expect(PRICE_ROLES.find((p) => p.id === "premium")?.ai).toBe(aiPagesMonthLabel(EXPERT.aiPerMonth));
  });

  it("is the only numeric source for API catalogs and limits", () => {
    for (const [id, q] of Object.entries(API_QUOTAS)) {
      expect(API_PLAN_LIMITS[id]).toEqual({
        creditsPerMonth: q.creditsPerMonth,
        standardPagesPerMonth: q.standardPagesPerMonth,
      });
      const catalog = API_PLAN_CATALOG.find((p) => p.id === id);
      expect(catalog?.quota).toBe(aiPagesMonthLabel(q.creditsPerMonth));
      expect(catalog?.features.some((f) => f.includes(formatCount(q.creditsPerMonth)))).toBe(true);
      expect(catalog?.features.some((f) => f.includes(formatCount(q.standardPagesPerMonth)))).toBe(true);
    }
  });
});
