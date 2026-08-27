import { fireEvent, render, screen } from "@testing-library/react";
import { FILL_NONE, FILL_WHITE, type EditorRegion } from "@/lib/editor-regions";
import { EditorRegionLayer, overlayBackground } from "@/components/editor-region-layer";

const region: EditorRegion = {
  id: "r1",
  page: 1,
  text: "Hello",
  original: "Hello",
  box: { x: 0.1, y: 0.1, w: 0.3, h: 0.08 },
  originalBox: { x: 0.1, y: 0.1, w: 0.3, h: 0.08 },
  font: {
    kind: "times",
    css: '"Times New Roman", Times, serif',
    bold: true,
    italic: false,
    nh: 0.04,
    color: { r: 0, g: 0, b: 0 },
  },
  originalFont: {
    kind: "times",
    css: '"Times New Roman", Times, serif',
    bold: true,
    italic: false,
    nh: 0.04,
    color: { r: 0, g: 0, b: 0 },
  },
  source: "pdf",
};

describe("EditorRegionLayer", () => {
  const layerProps = {
    regions: [region],
    draft: "Hello",
    pageHeightPx: 400,
    onStartEdit: vi.fn(),
    onDraftChange: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
    onResize: vi.fn(),
  };

  it("exposes resize handles on a selected box", () => {
    const onResize = vi.fn();
    render(
      <div style={{ width: 200, height: 200, position: "relative" }}>
        <EditorRegionLayer
          {...layerProps}
          activeId={null}
          selectedId="r1"
          onResize={onResize}
        />
      </div>,
    );
    const handle = screen.getByRole("slider", { name: "Resize se" });
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 140, clientY: 130 });
    fireEvent.pointerUp(window);
    expect(onResize).toHaveBeenCalled();
    const next = onResize.mock.calls[0][1] as EditorRegion["box"];
    expect(next.w).toBeGreaterThan(region.box.w);
    expect(next.h).toBeGreaterThan(region.box.h);
  });

  it("keeps the edit field inside the clicked box", () => {
    render(
      <div style={{ width: 200, height: 400, position: "relative" }}>
        <EditorRegionLayer {...layerProps} activeId="r1" selectedId="r1" />
      </div>,
    );
    const field = screen.getByLabelText("Edit text");
    const box = field.closest("[data-editor-box]") as HTMLElement;
    const page = field.closest("[data-editor-page]") as HTMLElement;
    expect(box.style.top).toBe("10%");
    expect(box.style.height).toBe("8%");
    expect(field.style.fontSize).toBe("16px");
    expect(page.style.fontSize).toBe("0px");
    expect(field.className).toContain("absolute");
    expect(field.className).toContain("inset-0");
    expect(field.className).not.toContain("min-h-full");
  });

  it("dismisses when clicking empty page space", () => {
    const onDismiss = vi.fn();
    render(
      <div style={{ width: 200, height: 200, position: "relative" }}>
        <EditorRegionLayer {...layerProps} activeId={null} selectedId="r1" onDismiss={onDismiss} />
      </div>,
    );
    const page = screen.getByLabelText('Edit “Hello”').closest("[data-editor-page]") as HTMLElement;
    fireEvent.pointerDown(page);
    expect(onDismiss).toHaveBeenCalled();
    onDismiss.mockClear();
    fireEvent.pointerDown(screen.getByLabelText('Edit “Hello”'));
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("drags a box to move it and does not start an edit", () => {
    const onResize = vi.fn();
    const onStartEdit = vi.fn();
    render(
      <div style={{ width: 200, height: 200, position: "relative" }}>
        <EditorRegionLayer
          {...layerProps}
          activeId={null}
          selectedId="r1"
          onResize={onResize}
          onStartEdit={onStartEdit}
        />
      </div>,
    );
    const box = screen.getByLabelText('Edit “Hello”');
    fireEvent.pointerDown(box, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 70 });
    fireEvent.pointerUp(window);
    expect(onResize).toHaveBeenCalled();
    const next = onResize.mock.calls[0][1] as EditorRegion["box"];
    expect(next.x).toBeGreaterThan(region.box.x);
    expect(next.y).toBeGreaterThan(region.box.y);
    expect(next.w).toBe(region.box.w);
    expect(next.h).toBe(region.box.h);
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it("clicks without dragging to edit", () => {
    const onStartEdit = vi.fn();
    render(
      <div style={{ width: 200, height: 200, position: "relative" }}>
        <EditorRegionLayer {...layerProps} activeId={null} selectedId={null} onStartEdit={onStartEdit} />
      </div>,
    );
    fireEvent.pointerDown(screen.getByLabelText('Edit “Hello”'), { clientX: 40, clientY: 40, button: 0 });
    fireEvent.pointerUp(window);
    expect(onStartEdit).toHaveBeenCalled();
  });

  it("covers original glyphs while editing and stays clear when only selected", () => {
    expect(overlayBackground(true, false, FILL_WHITE)).toBe("rgb(255 255 255)");
    expect(overlayBackground(true, false, FILL_NONE)).toBe("#ffffff");
    expect(overlayBackground(false, false, FILL_WHITE)).toBe("transparent");
    expect(overlayBackground(false, true, FILL_WHITE)).toBe("rgb(255 255 255)");
    expect(overlayBackground(false, true, FILL_NONE)).toBe("transparent");
    const selected = render(
      <div style={{ width: 200, height: 200, position: "relative" }}>
        <EditorRegionLayer {...layerProps} activeId={null} selectedId="r1" />
      </div>,
    );
    expect(screen.getByRole("button", { name: 'Edit “Hello”' })).toHaveTextContent("");
    expect(screen.getByRole("button", { name: 'Edit “Hello”' }).style.background).toBe("transparent");
    selected.unmount();
    render(
      <div style={{ width: 200, height: 400, position: "relative" }}>
        <EditorRegionLayer {...layerProps} activeId="r1" selectedId="r1" />
      </div>,
    );
    const field = screen.getByLabelText("Edit text");
    expect(field.style.background).not.toBe("transparent");
    expect(field.style.background).toMatch(/255/);
  });

  it("snapshots a move once at gesture start", () => {
    const onGestureStart = vi.fn();
    const onGestureEnd = vi.fn();
    render(
      <div style={{ width: 200, height: 200, position: "relative" }}>
        <EditorRegionLayer
          {...layerProps}
          activeId={null}
          selectedId="r1"
          onGestureStart={onGestureStart}
          onGestureEnd={onGestureEnd}
        />
      </div>,
    );
    const box = screen.getByLabelText('Edit “Hello”');
    fireEvent.pointerDown(box, { clientX: 40, clientY: 40, button: 0 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 70 });
    fireEvent.pointerMove(window, { clientX: 90, clientY: 80 });
    fireEvent.pointerUp(window);
    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });
});
