import {
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  applyDraft,
  cloneRegions,
  rememberRegions,
  redoRegions,
  undoRegions,
} from "@/lib/editor-history";
import type { EditorRegion } from "@/lib/editor-regions";

const font = {
  kind: "helvetica" as const,
  css: "Helvetica, Arial, sans-serif",
  bold: false,
  italic: false,
  nh: 0.03,
  color: { r: 0, g: 0, b: 0 },
};

function run(text: string): EditorRegion {
  return {
    id: "r1",
    page: 1,
    text,
    original: "Hello",
    box: { x: 0.1, y: 0.1, w: 0.3, h: 0.08 },
    originalBox: { x: 0.1, y: 0.1, w: 0.3, h: 0.08 },
    font,
    originalFont: font,
    source: "pdf",
  };
}

describe("editor history", () => {
  it("clones so later edits do not mutate snapshots", () => {
    const regions = [run("Hello")];
    const copy = cloneRegions(regions);
    regions[0].text = "Hi";
    regions[0].box.x = 0.9;
    expect(copy[0].text).toBe("Hello");
    expect(copy[0].box.x).toBe(0.1);
  });

  it("undoes and redoes a remembered snapshot", () => {
    const before = [run("Hello")];
    const after = [run("Hi")];
    const remembered = rememberRegions(EMPTY_HISTORY, before);
    expect(undoRegions(remembered, after)?.regions[0].text).toBe("Hello");
    const undone = undoRegions(remembered, after);
    expect(undone).not.toBeNull();
    const redone = redoRegions(undone!.history, undone!.regions);
    expect(redone?.regions[0].text).toBe("Hi");
    expect(undoRegions(EMPTY_HISTORY, after)).toBeNull();
    expect(redoRegions(EMPTY_HISTORY, after)).toBeNull();
  });

  it("clears redo when a new change is remembered", () => {
    const first = rememberRegions(EMPTY_HISTORY, [run("A")]);
    const undone = undoRegions(first, [run("B")]);
    expect(undone?.history.future).toHaveLength(1);
    const next = rememberRegions(undone!.history, undone!.regions);
    expect(next.future).toHaveLength(0);
  });

  it("caps history length", () => {
    let history = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 5; i += 1) {
      history = rememberRegions(history, [run(`n${i}`)]);
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0][0].text).toBe("n5");
  });

  it("applies the in-progress draft before snapshotting", () => {
    const regions = [run("Hello")];
    expect(applyDraft(regions, "r1", "Hi")[0].text).toBe("Hi");
    expect(applyDraft(regions, null, "Hi")[0].text).toBe("Hello");
    expect(applyDraft([run("Hello"), { ...run("Other"), id: "r2" }], "r1", "Hi").map((r) => r.text)).toEqual([
      "Hi",
      "Other",
    ]);
  });
});
