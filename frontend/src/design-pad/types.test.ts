import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createNode,
  createVariable,
  isContainer,
  isTextKind,
  isValidVariableName,
  normalizeDocument,
  nextStackedPosition,
} from "./types";

describe("design-pad types helpers", () => {
  it("validates variable names and kind helpers", () => {
    expect(isValidVariableName("employee.name")).toBe(true);
    expect(isValidVariableName("1bad")).toBe(false);
    expect(isContainer("box")).toBe(true);
    expect(isContainer("heading")).toBe(false);
    expect(isTextKind("paragraph")).toBe(true);
    expect(isTextKind("image")).toBe(false);
  });

  it("creates nodes/variables and stacks positions", () => {
    const box = createNode("box", 10, 20);
    expect(box.kind).toBe("box");
    expect(box.x).toBe(10);
    expect(createVariable("items", "Items", "list", "").sampleValue).toBe("[]");
    expect(createVariable("total", "Total", "currency", "").sampleValue).toBe("$0.00");
    expect(createVariable("n", "N", "number", "").sampleValue).toBe("0");
    expect(createVariable("t", "T", "text", " hi ").sampleValue).toBe(" hi ");

    const parent = createNode("box");
    parent.children = [createNode("paragraph", 0, 0)];
    parent.children[0].h = 40;
    const next = nextStackedPosition(parent);
    expect(next.y).toBeGreaterThan(0);
  });

  it("normalizes documents and rejects bad payloads", () => {
    const empty = createEmptyDocument();
    const normalized = normalizeDocument({
      ...empty,
      version: 1,
      variables: undefined,
      pageSize: undefined,
    });
    expect(normalized.version).toBe(2);
    expect(normalized.variables).toEqual([]);
    expect(normalized.pageSize.w).toBeGreaterThan(0);
    expect(() => normalizeDocument(null)).toThrow(/object/);
    expect(() => normalizeDocument({})).toThrow(/root/);
  });
});
