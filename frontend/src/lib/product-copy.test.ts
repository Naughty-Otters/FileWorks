import { describe, expect, it } from "vitest";
import { PRODUCT, produceActionLabel } from "@/lib/product-copy";

describe("product-copy", () => {
  it("frames Source meets Intent in the home line and one-liner", () => {
    expect(PRODUCT.homeLine).toMatch(/Drop a file/i);
    expect(PRODUCT.homeLine).toMatch(/produce/i);
    expect(PRODUCT.oneLiner.toLowerCase()).toContain("markdown");
    expect(PRODUCT.oneLiner.toLowerCase()).toContain("design");
    expect(PRODUCT.produceFromFile).toMatch(/Produce from file/i);
  });

  it("builds Convert vs Fill action labels", () => {
    expect(produceActionLabel({ intentName: null })).toBe("Convert");
    expect(produceActionLabel({ intentName: null, useAi: true })).toBe("AI Convert");
    expect(produceActionLabel({ intentName: "Client invoice" })).toBe("Fill Client invoice");
    expect(produceActionLabel({ intentName: "Client invoice", useAi: true })).toBe(
      "AI Fill Client invoice",
    );
  });
});
