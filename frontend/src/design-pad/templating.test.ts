import { createEmptyDocument, createNode, nextId } from "./types";
import { expandSampleDocument, isStaticTemplate } from "./templating";

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
});
