import { beforeEach, describe, expect, it } from "vitest";
import { applyDesignOps, resolveLastColumn, resolveParentRef, resetAiIdSequence } from "./executor";
import type { DesignOp } from "./schema";
import { validateOp, validateOps } from "./validate";
import { useEditorStore } from "../store";
import { createEmptyDocument, createNode } from "../types";

describe("design op validation", () => {
  it("rejects removing root", () => {
    const doc = createEmptyDocument();
    expect(validateOp(doc, { op: "remove_element", id: "root" })).toMatch(/root/);
  });

  it("rejects unknown node ids", () => {
    const doc = createEmptyDocument();
    expect(validateOp(doc, { op: "update_label", id: "missing", label: "Hi" })).toMatch(/Unknown/);
    expect(validateOp(doc, { op: "select", id: "missing" })).toMatch(/Unknown/);
    expect(validateOp(doc, { op: "remove_element", id: "missing" })).toMatch(/Unknown/);
    expect(validateOp(doc, { op: "add_element", kind: "box", parentId: "missing" })).toMatch(/Unknown parent/);
  });

  it("rejects invalid variable names", () => {
    const doc = createEmptyDocument();
    expect(
      validateOp(doc, { op: "add_variable", name: "bad-name", label: "Bad" }),
    ).toMatch(/Invalid/);
  });

  it("rejects duplicate variables and unknown variable ids", () => {
    const doc = createEmptyDocument();
    doc.variables.push({ id: "v1", name: "invoice_date", label: "Date", type: "date", sampleValue: "" });
    expect(
      validateOp(doc, { op: "add_variable", name: "invoice_date", label: "Again" }),
    ).toMatch(/already exists/);
    expect(validateOp(doc, { op: "remove_variable", id: "nope" })).toMatch(/Unknown variable/);
    expect(
      validateOp(doc, { op: "update_variable", id: "v1", patch: { name: "bad-name" } }),
    ).toMatch(/Invalid/);
    expect(validateOp(doc, { op: "update_variable", id: "v1", patch: { label: "OK" } })).toBeNull();
  });

  it("rejects adding children to a non-box parent", () => {
    const doc = createEmptyDocument();
    const heading = createNode("heading", 0, 0);
    doc.root.children.push(heading);
    expect(
      validateOp(doc, { op: "add_element", kind: "paragraph", parentId: heading.id }),
    ).toMatch(/not a box/);
  });

  it("accepts last_column / last_created aliases on add_element", () => {
    const doc = createEmptyDocument();
    expect(validateOp(doc, { op: "add_element", kind: "box", parentId: "last_column" })).toBeNull();
    expect(validateOp(doc, { op: "add_element", kind: "box", parentId: "last_created" })).toBeNull();
    expect(
      validateOp(doc, { op: "add_element", kind: "box", parentId: "last_created_sibling" }),
    ).toBeNull();
  });

  it("rejects heading levels outside 1–6", () => {
    const doc = createEmptyDocument();
    const heading = createNode("heading", 0, 0);
    doc.root.children.push(heading);
    expect(validateOp(doc, { op: "update_level", id: heading.id, level: 9 })).toMatch(/1–6/);
    expect(validateOp(doc, { op: "update_level", id: heading.id, level: 0 })).toMatch(/1–6/);
    expect(validateOp(doc, { op: "update_level", id: heading.id, level: 2 })).toBeNull();
  });

  it("validates move_in_tree edge cases", () => {
    const doc = createEmptyDocument();
    const heading = createNode("heading", 0, 0);
    doc.root.children.push(heading);
    expect(validateOp(doc, { op: "move_in_tree", id: "root", parentId: "root", index: 0 })).toMatch(
      /Cannot move root/,
    );
    expect(
      validateOp(doc, { op: "move_in_tree", id: "missing", parentId: "root", index: 0 }),
    ).toMatch(/Unknown node/);
    expect(
      validateOp(doc, { op: "move_in_tree", id: heading.id, parentId: "missing", index: 0 }),
    ).toMatch(/Unknown parent/);
    expect(
      validateOp(doc, { op: "move_in_tree", id: heading.id, parentId: heading.id, index: 0 }),
    ).toMatch(/not a box/);
    expect(
      validateOp(doc, { op: "move_in_tree", id: heading.id, parentId: "root", index: -1 }),
    ).toMatch(/Index/);
    expect(validateOp(doc, { op: "move_in_tree", id: heading.id, parentId: "root", index: 0 })).toBeNull();
  });

  it("rejects invalid page size", () => {
    const doc = createEmptyDocument();
    expect(validateOp(doc, { op: "set_page_width", w: 50 })).toMatch(/at least 100/);
    expect(validateOp(doc, { op: "set_page_count", n: 0 })).toMatch(/at least 1/);
    expect(validateOp(doc, { op: "set_page_width", w: 850 })).toBeNull();
    expect(validateOp(doc, { op: "set_page_count", n: 2 })).toBeNull();
  });

  it("simulates sequential add/remove for validateOps", () => {
    const doc = createEmptyDocument();
    const results = validateOps(doc, [
      { op: "add_element", kind: "heading", parentId: "root" },
      { op: "add_variable", name: "invoice_date", label: "Date" },
      { op: "remove_element", id: "sim_0" },
      { op: "remove_variable", id: "sim_var_0" },
      { op: "update_label", id: "missing", label: "x" },
    ]);
    expect(results.slice(0, 4).every((r) => r.ok)).toBe(true);
    expect(results[4]?.ok).toBe(false);
  });
});

describe("applyDesignOps", () => {
  beforeEach(() => {
    useEditorStore.setState({
      doc: createEmptyDocument(),
      selectedId: null,
      history: { past: [], future: [] },
    });
  });

  it("stacks omitted coordinates below existing freeform siblings", async () => {
    await applyDesignOps([{ op: "add_element", kind: "heading", parentId: "root" }]);
    const firstId = useEditorStore.getState().selectedId!;
    const first = useEditorStore.getState().doc.root.children.find((c) => c.id === firstId)!;
    expect(first.x).toBe(16);
    expect(first.y).toBe(16);

    await applyDesignOps([{ op: "add_element", kind: "paragraph", parentId: "root" }]);
    const secondId = useEditorStore.getState().selectedId!;
    const second = useEditorStore.getState().doc.root.children.find((c) => c.id === secondId)!;
    expect(second.y).toBeGreaterThan(first.y + first.h);
    expect(second.x).toBe(16);
  });

  it("adds a heading and updates its label in one batch", async () => {
    const ops: DesignOp[] = [
      { op: "add_element", kind: "heading", parentId: "root", x: 20, y: 20 },
    ];
    const { results } = await applyDesignOps(ops);
    expect(results[0]?.ok).toBe(true);
    const selectedId = useEditorStore.getState().selectedId;
    expect(selectedId).toBeTruthy();
    const node = useEditorStore.getState().doc.root.children.find((c) => c.id === selectedId);
    expect(node?.kind).toBe("heading");

    await applyDesignOps([{ op: "update_label", id: selectedId!, label: "Hello World" }]);
    const updated = useEditorStore.getState().doc.root.children.find((c) => c.id === selectedId);
    expect(updated?.label).toBe("Hello World");
  });

  it("groups undo into a single step", async () => {
    await applyDesignOps([
      { op: "add_element", kind: "paragraph", parentId: "root", x: 10, y: 10 },
    ]);
    expect(useEditorStore.getState().history.past.length).toBe(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().doc.root.children).toHaveLength(0);
  });

  it("reports validation errors without throwing", async () => {
    const { results } = await applyDesignOps([
      { op: "update_label", id: "nope", label: "X" },
    ]);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.error).toBeTruthy();
  });

  it("adds a template variable", async () => {
    await applyDesignOps([
      { op: "add_variable", name: "invoice_date", label: "Invoice date", type: "date" },
    ]);
    expect(useEditorStore.getState().doc.variables).toHaveLength(1);
    expect(useEditorStore.getState().doc.variables[0]?.name).toBe("invoice_date");
  });

  it("updates style and selects the node", async () => {
    await applyDesignOps([{ op: "add_element", kind: "heading", parentId: "root" }]);
    const id = useEditorStore.getState().selectedId!;
    const { affectedNodeIds } = await applyDesignOps([
      { op: "update_style", id, patch: { align: "center", fontSize: 32 } },
      { op: "select", id },
    ]);
    expect(affectedNodeIds).toContain(id);
    const node = useEditorStore.getState().doc.root.children.find((c) => c.id === id);
    expect(node?.style.align).toBe("center");
    expect(node?.style.fontSize).toBe(32);
    expect(useEditorStore.getState().selectedId).toBe(id);
  });

  it("toggles auto-layout and layout props on a box", async () => {
    await applyDesignOps([{ op: "add_element", kind: "box", parentId: "root" }]);
    const id = useEditorStore.getState().selectedId!;
    await applyDesignOps([
      { op: "toggle_auto_layout", id, enabled: true },
      { op: "update_layout_props", id, patch: { gap: 24, padding: 32, justify: "center" } },
    ]);
    const node = useEditorStore.getState().doc.root.children.find((c) => c.id === id);
    expect(node?.layout?.gap).toBe(24);
    expect(node?.layout?.padding).toBe(32);
    expect(node?.layout?.justify).toBe("center");
  });

  it("updates page width", async () => {
    await applyDesignOps([{ op: "set_page_width", w: 794 }]);
    expect(useEditorStore.getState().doc.pageSize.w).toBe(794);
  });

  it("removes an element", async () => {
    await applyDesignOps([{ op: "add_element", kind: "paragraph", parentId: "root" }]);
    const id = useEditorStore.getState().selectedId!;
    await applyDesignOps([{ op: "remove_element", id }]);
    expect(useEditorStore.getState().doc.root.children).toHaveLength(0);
  });

  it("moves resizes updates box level and page count", async () => {
    await applyDesignOps([{ op: "add_element", kind: "heading", parentId: "root" }]);
    const id = useEditorStore.getState().selectedId!;
    await applyDesignOps([
      { op: "move_node", id, x: 40, y: 50 },
      { op: "resize_node", id, w: 200, h: 60 },
      { op: "update_box", id, box: { x: 12, y: 18, w: 220, h: 70 } },
      { op: "update_level", id, level: 2 },
      { op: "update_node", id, patch: { level: 3 } },
      { op: "set_page_count", n: 2 },
    ]);
    const node = useEditorStore.getState().doc.root.children.find((c) => c.id === id);
    expect(node?.x).toBe(12);
    expect(node?.y).toBe(18);
    expect(node?.w).toBe(220);
    expect(node?.h).toBe(70);
    expect(node?.level).toBe(3);
    expect(useEditorStore.getState().doc.root.h).toBeGreaterThanOrEqual(
      useEditorStore.getState().doc.pageSize.h * 2,
    );
  });

  it("finishes a new box with last_created aliases in one step", async () => {
    await applyDesignOps([
      { op: "add_element", kind: "box", parentId: "root" },
      { op: "toggle_auto_layout", id: "last_created", enabled: true },
      {
        op: "update_layout_props",
        id: "last_created",
        patch: { direction: "column", gap: 8, padding: 16, align: "center" },
      },
      { op: "add_element", kind: "heading", parentId: "last_created" },
      { op: "update_label", id: "last_created", label: "{{ document_title }}" },
      { op: "update_style", id: "last_created", patch: { fontSize: 28, align: "center" } },
    ]);
    const box = useEditorStore.getState().doc.root.children.find((c) => c.kind === "box");
    expect(box?.layout).toBeTruthy();
    expect(box?.children).toHaveLength(1);
    expect(box?.children[0]?.kind).toBe("heading");
    expect(box?.children[0]?.label).toBe("{{ document_title }}");
  });

  it("moves nodes in the tree and nests under a box", async () => {
    await applyDesignOps([{ op: "add_element", kind: "box", parentId: "root" }]);
    const boxId = useEditorStore.getState().selectedId!;
    await applyDesignOps([
      { op: "add_element", kind: "paragraph", parentId: boxId, x: 8, y: 8 },
      { op: "add_element", kind: "heading", parentId: "last_created" },
    ]);
    const box = useEditorStore.getState().doc.root.children.find((c) => c.id === boxId);
    expect(box?.children.some((c) => c.kind === "paragraph")).toBe(true);
    expect(box?.children.some((c) => c.kind === "heading")).toBe(true);

    await applyDesignOps([{ op: "add_element", kind: "heading", parentId: "root" }]);
    const headingId = useEditorStore.getState().selectedId!;
    await applyDesignOps([
      { op: "move_in_tree", id: headingId, parentId: boxId, index: 0, x: 4, y: 4 },
    ]);
    expect(
      useEditorStore
        .getState()
        .doc.root.children.find((c) => c.id === boxId)
        ?.children.some((c) => c.id === headingId),
    ).toBe(true);

    const paraId = useEditorStore
      .getState()
      .doc.root.children.find((c) => c.id === boxId)
      ?.children.find((c) => c.kind === "paragraph")?.id;
    expect(paraId).toBeTruthy();
    await applyDesignOps([{ op: "move_in_tree", id: paraId!, parentId: "root", index: 0 }]);
    expect(useEditorStore.getState().doc.root.children.some((c) => c.id === paraId)).toBe(true);
  });

  it("stacks info rows under last_column without nesting row-in-row", async () => {
    resetAiIdSequence();
    // Mimic expand(add_section) + two expand(add_info_row) with last_column parents.
    await applyDesignOps(
      [
        { op: "toggle_auto_layout", id: "root", enabled: true },
        {
          op: "update_layout_props",
          id: "root",
          patch: { direction: "column", gap: 24, padding: 40, align: "stretch", justify: "start" },
        },
        { op: "add_element", kind: "box", parentId: "root" },
        { op: "toggle_auto_layout", id: "last_created", enabled: true },
        {
          op: "update_layout_props",
          id: "last_created",
          patch: { direction: "column", gap: 12, padding: 0, align: "stretch", justify: "start" },
        },
        { op: "update_label", id: "last_created", label: "Meta" },
        { op: "add_element", kind: "heading", parentId: "last_created" },
        { op: "update_label", id: "last_created", label: "Meta" },
        // row 1
        { op: "add_element", kind: "box", parentId: "last_column" },
        { op: "resize_node", id: "last_created", w: 700, h: 32 },
        { op: "toggle_auto_layout", id: "last_created", enabled: true },
        {
          op: "update_layout_props",
          id: "last_created",
          patch: { direction: "row", gap: 0, padding: 0, align: "center", justify: "space-between" },
        },
        { op: "add_element", kind: "paragraph", parentId: "last_created" },
        { op: "update_label", id: "last_created", label: "Date" },
        { op: "add_element", kind: "paragraph", parentId: "last_created_sibling" },
        { op: "update_label", id: "last_created", label: "2026-01-01" },
        // row 2 — must be sibling of row 1, not nested
        { op: "add_element", kind: "box", parentId: "last_column" },
        { op: "resize_node", id: "last_created", w: 700, h: 32 },
        { op: "toggle_auto_layout", id: "last_created", enabled: true },
        {
          op: "update_layout_props",
          id: "last_created",
          patch: { direction: "row", gap: 0, padding: 0, align: "center", justify: "space-between" },
        },
        { op: "add_element", kind: "paragraph", parentId: "last_created" },
        { op: "update_label", id: "last_created", label: "Price" },
        { op: "add_element", kind: "paragraph", parentId: "last_created_sibling" },
        { op: "update_label", id: "last_created", label: "$100" },
      ],
      { useAiIds: true },
    );

    const section = useEditorStore.getState().doc.root.children[0]!;
    expect(section.children.filter((c) => c.kind === "box")).toHaveLength(2);
    const rows = section.children.filter((c) => c.kind === "box");
    expect(rows.every((r) => r.children.every((c) => c.kind === "paragraph"))).toBe(true);
    expect(rows.every((r) => r.w >= 100)).toBe(true);
  });

  it("updates and removes variables and images", async () => {
    await applyDesignOps([
      { op: "add_variable", name: "client_name", label: "Client", type: "text", sampleValue: "Ada" },
      { op: "add_element", kind: "image", parentId: "root" },
    ]);
    const varId = useEditorStore.getState().doc.variables[0]!.id;
    const imageId = useEditorStore.getState().selectedId!;
    await applyDesignOps([
      { op: "update_variable", id: varId, patch: { label: "Customer", sampleValue: "Bob" } },
      { op: "update_image", id: imageId, patch: { imageSrc: "https://example.com/a.png", objectFit: "contain" } },
    ]);
    expect(useEditorStore.getState().doc.variables[0]?.label).toBe("Customer");
    const image = useEditorStore.getState().doc.root.children.find((c) => c.id === imageId);
    expect(image?.imageSrc).toBe("https://example.com/a.png");
    expect(image?.objectFit).toBe("contain");

    await applyDesignOps([{ op: "remove_variable", id: varId }]);
    expect(useEditorStore.getState().doc.variables).toHaveLength(0);
  });

  it("resolveLastColumn walks past row wrappers to the section", async () => {
    resetAiIdSequence();
    await applyDesignOps(
      [
        { op: "toggle_auto_layout", id: "root", enabled: true },
        {
          op: "update_layout_props",
          id: "root",
          patch: { direction: "column", gap: 20, padding: 40, align: "stretch", justify: "start" },
        },
        { op: "add_element", kind: "box", parentId: "root" },
        { op: "toggle_auto_layout", id: "last_created", enabled: true },
        {
          op: "update_layout_props",
          id: "last_created",
          patch: { direction: "column", gap: 12, padding: 0, align: "stretch", justify: "start" },
        },
        { op: "add_element", kind: "box", parentId: "last_created" },
        { op: "toggle_auto_layout", id: "last_created", enabled: true },
        {
          op: "update_layout_props",
          id: "last_created",
          patch: { direction: "row", gap: 0, padding: 0, align: "center", justify: "space-between" },
        },
        { op: "add_element", kind: "paragraph", parentId: "last_created" },
        { op: "update_label", id: "last_created", label: "Value" },
      ],
      { useAiIds: true },
    );
    const valueId = useEditorStore.getState().selectedId!;
    const sectionId = useEditorStore.getState().doc.root.children[0]!.id;
    expect(resolveLastColumn(valueId)).toBe(sectionId);
    expect(resolveParentRef("last_column", valueId)).toBe(sectionId);
    // last_created_sibling from the value paragraph is the ROW — the nesting bug.
    const rowId = useEditorStore.getState().doc.root.children[0]!.children[0]!.id;
    expect(resolveParentRef("last_created_sibling", valueId)).toBe(rowId);
  });
});
