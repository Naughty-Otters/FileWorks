import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorInsertBar } from "@/components/editor-insert-bar";

describe("EditorInsertBar", () => {
  it("emits insert actions for text and shapes", async () => {
    const user = userEvent.setup();
    const onInsert = vi.fn();
    const onInsertImage = vi.fn();
    render(<EditorInsertBar onInsert={onInsert} onInsertImage={onInsertImage} />);
    await user.click(screen.getByRole("button", { name: "Insert text box" }));
    await user.click(screen.getByRole("button", { name: "Insert rectangle" }));
    await user.click(screen.getByRole("button", { name: "Insert ellipse" }));
    await user.click(screen.getByRole("button", { name: "Insert line" }));
    expect(onInsert.mock.calls.map((call) => call[0])).toEqual(["text", "rect", "ellipse", "line"]);
    await user.click(screen.getByRole("button", { name: "Insert image" }));
    const imageInput = document.querySelector('input[accept^="image"]') as HTMLInputElement;
    await user.upload(imageInput, new File(["img"], "logo.png", { type: "image/png" }));
    expect(onInsertImage).toHaveBeenCalled();
  });
});
