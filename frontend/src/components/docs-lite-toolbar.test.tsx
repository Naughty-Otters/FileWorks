import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/react";
import { DocsLiteToolbar } from "@/components/docs-lite-toolbar";

function mockEditor(overrides: Partial<Editor> = {}): Editor {
  const chain = {
    focus: vi.fn().mockReturnThis(),
    toggleHeading: vi.fn().mockReturnThis(),
    toggleBold: vi.fn().mockReturnThis(),
    toggleItalic: vi.fn().mockReturnThis(),
    toggleStrike: vi.fn().mockReturnThis(),
    toggleCode: vi.fn().mockReturnThis(),
    toggleBulletList: vi.fn().mockReturnThis(),
    toggleOrderedList: vi.fn().mockReturnThis(),
    toggleBlockquote: vi.fn().mockReturnThis(),
    setHorizontalRule: vi.fn().mockReturnThis(),
    insertTable: vi.fn().mockReturnThis(),
    extendMarkRange: vi.fn().mockReturnThis(),
    setLink: vi.fn().mockReturnThis(),
    unsetLink: vi.fn().mockReturnThis(),
    setImage: vi.fn().mockReturnThis(),
    run: vi.fn().mockReturnValue(true),
  };
  return {
    isActive: vi.fn().mockReturnValue(false),
    getAttributes: vi.fn().mockReturnValue({}),
    chain: vi.fn(() => chain),
    ...overrides,
  } as unknown as Editor;
}

describe("DocsLiteToolbar", () => {
  it("disables controls when there is no editor", () => {
    render(<DocsLiteToolbar editor={null} />);
    expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Heading 1" })).toBeDisabled();
  });

  it("runs formatting commands from each tool button", async () => {
    const user = userEvent.setup();
    const editor = mockEditor();
    render(<DocsLiteToolbar editor={editor} />);

    const labels = [
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bold",
      "Italic",
      "Strikethrough",
      "Inline code",
      "Bullet list",
      "Numbered list",
      "Quote",
      "Divider",
      "Table",
    ];
    for (const label of labels) {
      await user.click(screen.getByRole("button", { name: label }));
    }
    expect(editor.chain).toHaveBeenCalled();
    const chain = (editor.chain as ReturnType<typeof vi.fn>).mock.results[0]?.value;
    expect(chain.run).toHaveBeenCalled();
  });

  it("sets and clears links from the prompt", async () => {
    const user = userEvent.setup();
    const editor = mockEditor({
      getAttributes: vi.fn().mockReturnValue({ href: "https://old.example" }),
    });
    render(<DocsLiteToolbar editor={editor} />);

    vi.spyOn(window, "prompt").mockReturnValueOnce("https://new.example");
    await user.click(screen.getByRole("button", { name: "Link" }));
    expect(window.prompt).toHaveBeenCalled();

    vi.spyOn(window, "prompt").mockReturnValueOnce("   ");
    await user.click(screen.getByRole("button", { name: "Link" }));

    vi.spyOn(window, "prompt").mockReturnValueOnce(null);
    await user.click(screen.getByRole("button", { name: "Link" }));
  });

  it("inserts an image from the file picker", async () => {
    const editor = mockEditor();
    render(<DocsLiteToolbar editor={editor} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();

    const file = new File(["fake"], "shot.png", { type: "image/png" });
    const readerProto = FileReader.prototype;
    vi.spyOn(readerProto, "readAsDataURL").mockImplementation(function (this: FileReader) {
      Object.defineProperty(this, "result", { value: "data:image/png;base64,xxx" });
      this.onload?.({} as ProgressEvent<FileReader>);
    });

    await userEvent.click(screen.getByRole("button", { name: "Image" }));
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(editor.chain).toHaveBeenCalled();
    });
  });
});
