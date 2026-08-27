import { describe, expect, it } from "vitest";
import {
  API_FREE,
  API_QUOTAS,
  CASUAL,
  DAILY,
  EXPERT,
  WORKSPACE_QUOTAS,
  YEARLY_DISCOUNT,
  aiPagesMonthLabel,
  apiDocsFaqAnswer,
  apiFreeQuotaSentence,
  casualAiAllowanceFaqAnswer,
  casualConvertTeaser,
  casualFreeTierFaqAnswer,
  casualLoginBlurb,
  casualOfferDescription,
  casualSignupSentence,
  checkoutCanceledNotice,
  equivalentMonthlyLabel,
  formatCount,
  formatUsdForInterval,
  formatUsdMonth,
  formatUsdYear,
  freeCasualCardFaqAnswer,
  pricingCostFaqAnswer,
  pricingPageDescription,
  yearlyAmountFromMonthly,
} from "@/lib/plan-quotas";
import {
  API_PLAN_CATALOG,
  API_PLAN_LIMITS,
  PLAN_CATALOG,
  PLAN_LIMITS,
  PLAN_RULES,
  PRICE_ROLES,
  formatPlanPriceForInterval,
} from "@/lib/plans";

describe("plan-quotas", () => {
  it("keeps thinned free-tier counts as the catalog source of truth", () => {
    expect(CASUAL.extractsPerDay).toBe(15);
    expect(CASUAL.aiPerMonth).toBe(2);
    expect(API_FREE.creditsPerMonth).toBe(2);
    expect(API_FREE.standardPagesPerMonth).toBe(500);
    expect(API_FREE.maxKeys).toBe(1);
    expect(PLAN_LIMITS.basic).toMatchObject({
      extractsPerDay: 15,
      aiPerMonth: 2,
    });
    expect(API_PLAN_LIMITS.api_free).toEqual({
      creditsPerMonth: 2,
      standardPagesPerMonth: 500,
    });
  });

  it("prices yearly at 30% off the annual monthly total", () => {
    expect(YEARLY_DISCOUNT).toBe(0.3);
    expect(yearlyAmountFromMonthly(0)).toBe(0);
    expect(yearlyAmountFromMonthly(5)).toBe(42);
    expect(yearlyAmountFromMonthly(29)).toBe(244);
    expect(yearlyAmountFromMonthly(99)).toBe(832);
    expect(formatUsdMonth(5)).toBe("$5 / month");
    expect(formatUsdYear(42)).toBe("$42 / year");
    expect(formatUsdForInterval(5, "month")).toBe("$5 / month");
    expect(formatUsdForInterval(5, "year")).toBe("$42 / year");
    expect(formatUsdForInterval(0, "year")).toBe("Free");
    expect(formatUsdForInterval(null, "month")).toBe("—");
    expect(equivalentMonthlyLabel(5)).toBe("$3.50 / mo billed yearly");
    expect(equivalentMonthlyLabel(29)).toBe("$20.33 / mo billed yearly");
    expect(formatPlanPriceForInterval(29, "year")).toBe("$244 / year");
    expect(formatPlanPriceForInterval(DAILY.priceUsd, "month")).toBe("$5 / month");
    expect(formatPlanPriceForInterval(EXPERT.priceUsd, "year")).toBe("$244 / year");
  });

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
    expect(PRICE_ROLES.find((p) => p.id === "basic")?.quota).toContain("15");
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
      expect(catalog?.features.some((f) => f.includes(formatCount(q.maxKeys)))).toBe(true);
    }
  });

  it("builds marketing and FAQ copy from free-tier quotas", () => {
    expect(casualSignupSentence()).toMatch(/15 conversions/);
    expect(casualSignupSentence()).toMatch(/2 AI pages/);
    expect(casualLoginBlurb()).toMatch(/\$5/);
    expect(apiFreeQuotaSentence()).toMatch(/500 standard pages/);
    expect(pricingCostFaqAnswer()).toMatch(/\$29\/month/);
    expect(apiDocsFaqAnswer()).toMatch(/\$5\/month/);
    expect(freeCasualCardFaqAnswer()).toMatch(/API Free/);
    expect(casualFreeTierFaqAnswer()).toMatch(/15 conversions/);
    expect(casualAiAllowanceFaqAnswer()).toMatch(/2 AI \/ translation pages/);
    expect(casualOfferDescription()).toMatch(/15 conversions/);
    expect(checkoutCanceledNotice()).toMatch(/15 conversions \/ day/);
    expect(pricingPageDescription()).toMatch(/Daily \$5\/mo/);
    expect(casualConvertTeaser()).toMatch(/no credit card/);
  });
});
