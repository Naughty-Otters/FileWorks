import { describe, expect, it } from "vitest";
import {
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
  it("keeps restored AI pools as the catalog source of truth", () => {
    expect(CASUAL).toMatchObject({ priceUsd: 0, extractsPerDay: 15, aiPerMonth: 25 });
    expect(DAILY).toMatchObject({ priceUsd: 5, extractsPerDay: 40, aiPerMonth: 500 });
    expect(EXPERT).toMatchObject({ priceUsd: 29, extractsPerDay: 200, aiPerMonth: 5000 });
    expect(API_QUOTAS.api_free).toMatchObject({
      priceUsd: 0,
      creditsPerMonth: 25,
      standardPagesPerMonth: 1000,
      maxKeys: 2,
    });
    expect(API_QUOTAS.api_builder).toMatchObject({
      priceUsd: 5,
      creditsPerMonth: 500,
      standardPagesPerMonth: 5000,
      maxKeys: 5,
    });
    expect(API_QUOTAS.api_scale).toMatchObject({
      priceUsd: 29,
      creditsPerMonth: 5000,
      standardPagesPerMonth: 20000,
      maxKeys: 20,
    });
    expect(API_QUOTAS.api_business).toMatchObject({
      priceUsd: 99,
      creditsPerMonth: 10000,
      standardPagesPerMonth: 40000,
      maxKeys: 20,
      hidden: true,
    });
    expect(PLAN_LIMITS.basic).toMatchObject({
      extractsPerDay: 15,
      aiPerMonth: 25,
    });
    expect(PLAN_LIMITS.pro).toMatchObject({ extractsPerDay: 40, aiPerMonth: 500 });
    expect(PLAN_LIMITS.premium).toMatchObject({ extractsPerDay: 200, aiPerMonth: 5000 });
    expect(API_PLAN_LIMITS.api_free).toEqual({
      creditsPerMonth: 25,
      standardPagesPerMonth: 1000,
    });
    expect(API_PLAN_LIMITS.api_builder).toEqual({
      creditsPerMonth: 500,
      standardPagesPerMonth: 5000,
    });
    expect(API_PLAN_LIMITS.api_scale).toEqual({
      creditsPerMonth: 5000,
      standardPagesPerMonth: 20000,
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

    expect(PLAN_RULES.find((p) => p.id === "pro")?.extras).toBe(
      `${aiPagesMonthLabel(DAILY.aiPerMonth)} · editor save`,
    );
    expect(PRICE_ROLES.find((p) => p.id === "basic")?.ai).toBe(aiPagesMonthLabel(CASUAL.aiPerMonth));
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
    expect(casualSignupSentence()).toMatch(/25 AI pages/);
    expect(casualLoginBlurb()).toMatch(/\$5/);
    expect(apiFreeQuotaSentence()).toMatch(/1,000 standard pages/);
    expect(pricingCostFaqAnswer()).toMatch(/\$29\/month/);
    expect(apiDocsFaqAnswer()).toMatch(/\$5\/month/);
    expect(freeCasualCardFaqAnswer()).toMatch(/API Free/);
    expect(casualFreeTierFaqAnswer()).toMatch(/15 conversions/);
    expect(casualAiAllowanceFaqAnswer()).toMatch(/25 AI \/ translation pages/);
    expect(casualOfferDescription()).toMatch(/15 conversions/);
    expect(checkoutCanceledNotice()).toMatch(/15 conversions \/ day/);
    expect(pricingPageDescription()).toMatch(/Daily \$5\/mo/);
    expect(casualConvertTeaser()).toMatch(/no credit card/);
  });
});
