import { createEmptyDocument, createNode, createVariable, nextId } from "./types";
import {
  expandSampleDocument,
  extractUsedVariableNames,
  isPureVariableToken,
  isStaticTemplate,
  parseSegments,
  resolveTemplate,
} from "./templating";

describe("template utilities", () => {
  it("detects truly static templates", () => {
    const doc = createEmptyDocument();
    doc.root.children.push(createNode("paragraph"));
    expect(isStaticTemplate(doc)).toBe(true);
    doc.root.children[0].label = "Hello {{ name }}";
    expect(isStaticTemplate(doc)).toBe(false);
  });

  it("treats declarations and repeaters as dynamic", () => {
    const declared = createEmptyDocument();
    declared.variables.push({ id: nextId("var"), name: "name", label: "Name", type: "text", sampleValue: "Ada" });
    expect(isStaticTemplate(declared)).toBe(false);

    const repeated = createEmptyDocument();
    const row = createNode("box");
    row.repeat = { over: "items", as: "item" };
    repeated.root.children.push(row);
    expect(isStaticTemplate(repeated)).toBe(false);
  });

  it("expands list samples and relayouts repeated boxes", () => {
    const doc = createEmptyDocument();
    doc.variables.push({
      id: nextId("var"),
      name: "items",
      label: "Items",
      type: "list",
      sampleValue: '[{"name":"One"},{"name":"Two"}]',
    });
    const row = createNode("box");
    row.repeat = { over: "items", as: "item" };
    const text = createNode("paragraph");
    text.label = "{{ item.name }}";
    row.children.push(text);
    doc.root.children.push(row);
    const expanded = expandSampleDocument(doc);
    expect(expanded.root.children).toHaveLength(2);
    expect(expanded.root.children.map((item) => item.children[0].label)).toEqual(["One", "Two"]);
  });

  it("parses token segments and resolves defaults", () => {
    expect(parseSegments("Hi {{ name }}!")).toEqual([
      { type: "text", value: "Hi " },
      { type: "var", name: "name" },
      { type: "text", value: "!" },
    ]);
    expect(isPureVariableToken("{{ logo }}")).toBe("logo");
    expect(isPureVariableToken("x {{ logo }}")).toBeNull();

    const vars = [createVariable("name", "Name", "text", "Ada")];
    expect(resolveTemplate("Hello {{ name }}", vars)).toBe("Hello Ada");
    expect(resolveTemplate("Hello {{ missing }}", vars)).toBe("Hello ⟨missing⟩");
  });

  it("extracts used variable names including repeats and images", () => {
    const doc = createEmptyDocument();
    const heading = createNode("heading");
    heading.label = "Hi {{ employee.name }}";
    const image = createNode("image");
    image.imageSrc = "{{ logo }}";
    const row = createNode("box");
    row.repeat = { over: "items", as: "item" };
    doc.root.children.push(heading, image, row);
    expect([...extractUsedVariableNames(doc.root)].sort()).toEqual(["employee.name", "items", "logo"]);
  });

  it("handles invalid list/object sample JSON gracefully", () => {
    const doc = createEmptyDocument();
    doc.variables.push(
      { id: nextId("var"), name: "items", label: "Items", type: "list", sampleValue: "not-json" },
      { id: nextId("var"), name: "customer", label: "Customer", type: "object", sampleValue: "{" },
    );
    const row = createNode("box");
    row.repeat = { over: "items", as: "item" };
    doc.root.children.push(row);
    const expanded = expandSampleDocument(doc);
    expect(expanded.root.children).toHaveLength(0);
  });

  it("resolves object paths and expands row layout", () => {
    const doc = createEmptyDocument();
    doc.variables.push({
      id: nextId("var"),
      name: "customer",
      label: "Customer",
      type: "object",
      sampleValue: '{"name":"Acme"}',
    });
    const row = createNode("box");
    row.layout = {
      direction: "row",
      gap: 8,
      padding: 4,
      align: "stretch",
      justify: "start",
    };
    const left = createNode("paragraph");
    left.label = "{{ customer.name }}";
    left.w = 40;
    left.h = 20;
    const right = createNode("paragraph");
    right.label = "ok";
    right.w = 40;
    right.h = 20;
    row.children.push(left, right);
    doc.root.children.push(row);
    const expanded = expandSampleDocument(doc);
    expect(expanded.root.children[0].children[0].label).toBe("Acme");
    expect(expanded.root.children[0].children[1].x).toBeGreaterThan(0);
  });
});
