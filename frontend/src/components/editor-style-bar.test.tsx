import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorStyleBar } from "@/components/editor-style-bar";
import { FILL_WHITE, type EditorRegion } from "@/lib/editor-regions";

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
    bold: false,
    italic: false,
    nh: 0.03,
    color: { r: 0, g: 0, b: 0 },
  },
  originalFont: {
    kind: "times",
    css: '"Times New Roman", Times, serif',
    bold: false,
    italic: false,
    nh: 0.03,
    color: { r: 0, g: 0, b: 0 },
  },
  source: "pdf",
  object: "text",
  align: "left",
  originalAlign: "left",
  fill: FILL_WHITE,
  originalFill: FILL_WHITE,
};

describe("EditorStyleBar", () => {
  it("stays disabled until a run is selected", () => {
    render(<EditorStyleBar region={null} pageHeightPx={800} onChange={vi.fn()} />);
    expect(screen.getByRole("toolbar", { name: "Text style" })).toHaveAttribute("title", "Click text to format");
    expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("patches family, size, weight, alignment, fill, and palette color", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EditorStyleBar region={region} pageHeightPx={800} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange.mock.calls[0][0].font).toMatchObject({ bold: true, kind: "times" });
    await user.click(screen.getByRole("button", { name: "Larger" }));
    expect(onChange.mock.calls[1][0].font.nh).toBeGreaterThan(region.font.nh);
    await user.selectOptions(screen.getByLabelText("Font"), "courier");
    expect(onChange.mock.calls[2][0].font).toMatchObject({ kind: "courier" });
    await user.click(screen.getByRole("button", { name: "Align center" }));
    expect(onChange.mock.calls[3][0]).toMatchObject({ align: "center" });
    await user.click(screen.getByRole("button", { name: "Fill" }));
    await user.click(screen.getByRole("button", { name: "Transparent" }));
    expect(onChange.mock.calls[4][0].fill).toEqual({ kind: "none" });
    await user.click(screen.getByRole("button", { name: "Text color" }));
    await user.click(screen.getByRole("button", { name: "Red" }));
    expect(onChange.mock.calls[5][0].font.color).toMatchObject({ r: 204 / 255, g: 0, b: 0 });
  });

  it("colors a shape from the fill palette", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EditorStyleBar
        region={{ ...region, object: "rect", text: "", original: "", source: "draw" }}
        pageHeightPx={800}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("button", { name: "Bold" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Color" }));
    await user.click(screen.getByRole("button", { name: "Blue" }));
    expect(onChange.mock.calls[0][0].fill.kind).toBe("color");
    expect(onChange.mock.calls[0][0].font.color).toMatchObject({ r: 61 / 255, g: 133 / 255, b: 198 / 255 });
  });
});
