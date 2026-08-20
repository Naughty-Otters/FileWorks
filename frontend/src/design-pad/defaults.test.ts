import { describe, expect, it } from "vitest";
import { effectiveDefault, typeDefaultValue } from "./defaults";
import { createVariable } from "./types";

describe("defaults", () => {
  it("covers type fallbacks", () => {
    expect(typeDefaultValue("list")).toBe("[]");
    expect(typeDefaultValue("object")).toBe("{}");
    expect(typeDefaultValue("number")).toBe("0");
    expect(typeDefaultValue("currency")).toBe("$0.00");
    expect(typeDefaultValue("date")).toMatch(/\d/);
    expect(typeDefaultValue("image")).toBe("");
    expect(typeDefaultValue("text")).toBe("");
  });

  it("prefers sample, then type, then label", () => {
    expect(effectiveDefault(createVariable("n", "N", "number", "9"))).toBe("9");
    expect(effectiveDefault(createVariable("n", "N", "number", ""))).toBe("0");
    expect(effectiveDefault(createVariable("co", "Acme", "text", ""))).toBe("Acme");
    expect(effectiveDefault(createVariable("co", "", "text", ""))).toBe("co");
    expect(effectiveDefault(createVariable("logo", "Logo", "image", ""))).toBe("");
  });
});
