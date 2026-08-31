import { beforeEach, describe, expect, it } from "vitest";
import { applyDesignOps } from "./executor";
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
});
