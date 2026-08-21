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
    // Freeform root: second repeat instance is pushed below the first.
    expect(expanded.root.children[1].y).toBeGreaterThanOrEqual(
      expanded.root.children[0].y + expanded.root.children[0].h,
    );
  });

  it("grows auto-layout sections and pushes later freeform siblings down", () => {
    const doc = createEmptyDocument();
    doc.variables.push({
      id: nextId("var"),
      name: "items",
      label: "Items",
      type: "list",
      sampleValue: '[{"name":"A"},{"name":"B"},{"name":"C"}]',
    });

    const header = createNode("box");
    header.label = "Header";
    header.w = 400;
    header.h = 40;
    header.x = 40;
    header.y = 40;
    header.layout = {
      direction: "column",
      gap: 0,
      padding: 8,
      align: "stretch",
      justify: "start",
    };
    const headerText = createNode("paragraph");
    headerText.label = "Title";
    headerText.h = 24;
    header.children.push(headerText);

    const itemRow = createNode("box");
    itemRow.w = 360;
    itemRow.h = 28;
    itemRow.repeat = { over: "items", as: "item" };
    itemRow.layout = {
      direction: "row",
      gap: 8,
      padding: 0,
      align: "center",
      justify: "start",
    };
    const itemText = createNode("paragraph");
    itemText.label = "{{ item.name }}";
    itemText.w = 200;
    itemText.h = 20;
    itemRow.children.push(itemText);

    const list = createNode("box");
    list.label = "List";
    list.w = 400;
    list.h = 60; // authored for one row; sample has three
    list.x = 40;
    list.y = 96;
    list.layout = {
      direction: "column",
      gap: 8,
      padding: 12,
      align: "stretch",
      justify: "start",
    };
    list.children.push(itemRow);

    const footer = createNode("box");
    footer.label = "Footer";
    footer.w = 400;
    footer.h = 40;
    footer.x = 40;
    footer.y = 172;
    footer.layout = {
      direction: "column",
      gap: 0,
      padding: 8,
      align: "stretch",
      justify: "start",
    };
    const footerText = createNode("paragraph");
    footerText.label = "End";
    footerText.h = 24;
    footer.children.push(footerText);

    doc.root.children.push(header, list, footer);

    const expanded = expandSampleDocument(doc);
    const [h, section, foot] = expanded.root.children;
    expect(section.children).toHaveLength(3);
    expect(section.h).toBeGreaterThan(60);
    expect(foot.y).toBeGreaterThanOrEqual(section.y + section.h);
    expect(expanded.root.h).toBeGreaterThanOrEqual(foot.y + foot.h);
    expect(h.y).toBe(40);
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
