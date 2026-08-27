import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TextDocumentEditor } from "@/components/text-document-editor";
import * as sessionFiles from "@/lib/workspace-session";
import * as editorFiles from "@/lib/editor-files";

vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...actual,
    useSession: () => ({
      status: "ready",
      me: null,
      displayUser: null,
    }),
    reloadSession: vi.fn(async () => null),
  };
});

describe("TextDocumentEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(sessionFiles, "loadEditorFile").mockResolvedValue(null);
    vi.spyOn(sessionFiles, "saveEditorFile").mockResolvedValue();
    vi.spyOn(sessionFiles, "saveSessionFile").mockResolvedValue();
    vi.spyOn(editorFiles, "downloadBlob").mockImplementation(() => undefined);
    vi.spyOn(editorFiles, "canUseFilePicker").mockReturnValue(false);
  });

  it("opens a markdown file and shows content in Document mode", async () => {
    const md = new File(["# Title\n\nHello"], "note.md", { type: "text/markdown" });
    vi.spyOn(sessionFiles, "loadEditorFile").mockResolvedValue(md);

    const { container } = render(<TextDocumentEditor />);
    expect(await screen.findByText("note.md")).toBeInTheDocument();

    await waitFor(
      () => {
        const prose = container.querySelector(".ProseMirror, [aria-label='Document']");
        expect(prose).toBeTruthy();
        expect(prose?.textContent ?? "").toMatch(/Title/);
        expect(prose?.textContent ?? "").toMatch(/Hello/);
      },
      { timeout: 4000 },
    );
  });

  it("opens a markdown file and saves from source mode", async () => {
    const user = userEvent.setup();
    const md = new File(["# Title\n\nHello"], "note.md", { type: "text/markdown" });
    vi.spyOn(sessionFiles, "loadEditorFile").mockResolvedValue(md);

    render(<TextDocumentEditor />);
    expect(await screen.findByText("note.md")).toBeInTheDocument();
    expect(screen.getByText(/Text and Word \(\.docx\) open in TipTap/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Source" }));
    const source = screen.getByLabelText("Document source");
    await user.clear(source);
    await user.type(source, "# New");

    await user.click(screen.getByRole("button", { name: "Download copy" }));
    await waitFor(() => expect(editorFiles.downloadBlob).toHaveBeenCalled());
    expect(sessionFiles.saveEditorFile).toHaveBeenCalled();
  });

  it("opens JSON in TipTap document mode without converting", async () => {
    const json = new File(['{"hello":"world"}'], "data.json", { type: "application/json" });
    vi.spyOn(sessionFiles, "loadEditorFile").mockResolvedValue(json);

    const { container } = render(<TextDocumentEditor />);
    expect(await screen.findByText("data.json")).toBeInTheDocument();

    await waitFor(
      () => {
        const prose = container.querySelector(".ProseMirror, [aria-label='Document']");
        expect(prose).toBeTruthy();
        expect(prose?.textContent ?? "").toMatch(/hello/);
        expect(prose?.textContent ?? "").toMatch(/world/);
      },
      { timeout: 4000 },
    );
  });

  it("keeps CSV in source mode only", async () => {
    const csv = new File(["a,b\n1,2"], "table.csv", { type: "text/csv" });
    vi.spyOn(sessionFiles, "loadEditorFile").mockResolvedValue(csv);
    render(<TextDocumentEditor />);
    expect(await screen.findByText("table.csv")).toBeInTheDocument();
    expect(screen.getByText("Source only")).toBeInTheDocument();
    expect(screen.getByLabelText("Document source")).toHaveValue("a,b\n1,2");
    expect(screen.queryByRole("button", { name: "Document" })).not.toBeInTheDocument();
  });
});
