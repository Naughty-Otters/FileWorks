import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PageEditor } from "@/components/page-editor";
import * as api from "@/lib/api";
import type { MeResponse } from "@/lib/api";
import * as editorPdf from "@/lib/editor-pdf";
import * as editorFiles from "@/lib/editor-files";
import * as sessionFiles from "@/lib/workspace-session";

vi.mock("@/lib/editor-pdf", () => ({
  openPdfDocument: vi.fn(),
  extractPdfRegions: vi.fn(),
  renderPdfPage: vi.fn(),
  renderPdfPageBlob: vi.fn(),
  renderPdfThumbs: vi.fn(),
  isPasswordPdfError: () => false,
  isRenderCancelled: () => false,
}));

vi.mock("@/lib/editor-save", () => ({
  stampPdfBytes: vi.fn(async () => new Uint8Array([1, 2, 3])),
  stampImageFile: vi.fn(async () => new Blob(["img"], { type: "image/png" })),
  paintImageStamps: vi.fn(),
}));

const guestMe: MeResponse = {
  user: null,
  plan: "anonymous",
  permissions: {},
  quota: {
    used_day: 0,
    used_month: 0,
    limit_day: null,
    limit_month: null,
    remaining_day: null,
    remaining_month: null,
    used_ai_day: 0,
    used_ai_month: 0,
    limit_ai_day: null,
    limit_ai_month: null,
    remaining_ai_day: null,
    remaining_ai_month: null,
  },
  google_client_id: null,
};

describe("PageEditor", () => {
  beforeEach(() => {
    vi.spyOn(api, "fetchMe").mockResolvedValue(guestMe);
    vi.spyOn(api, "extractDocument");
    vi.spyOn(sessionFiles, "loadEditorFile").mockResolvedValue(null);
    vi.spyOn(sessionFiles, "saveEditorFile").mockResolvedValue();
    vi.spyOn(sessionFiles, "saveSessionFile").mockResolvedValue();
    vi.spyOn(editorFiles, "downloadBlob").mockImplementation(() => undefined);
    vi.mocked(editorPdf.openPdfDocument).mockResolvedValue({
      pageCount: 2,
      getPage: vi.fn(),
      destroy: vi.fn(),
    });
    vi.mocked(editorPdf.extractPdfRegions).mockResolvedValue([
      {
        id: "pdf-p1-0",
        page: 1,
        text: "Hello",
        original: "Hello",
        box: { x: 0.1, y: 0.1, w: 0.4, h: 0.08 },
        originalBox: { x: 0.1, y: 0.1, w: 0.4, h: 0.08 },
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
      },
    ]);
    vi.mocked(editorPdf.renderPdfThumbs).mockResolvedValue(["data:image/png;base64,aaa"]);
    vi.mocked(editorPdf.renderPdfPage).mockResolvedValue({ width: 100, height: 100 });
  });

  it("lands empty with Open/Save and no Convert play button", async () => {
    render(<PageEditor />);
    expect(await screen.findByText(/Open a PDF or image\. Click the text\. Save/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download copy" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save as" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(screen.getByRole("link", { name: /Produce a Design/i })).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: "Editor" })[0]).toHaveAttribute("href", "/edit");
    expect(screen.queryByRole("button", { name: "Convert" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "FileWorks" })).toHaveAttribute("href", "/");
  });

  it("rejects office files with a Convert CTA", async () => {
    const user = userEvent.setup();
    render(<PageEditor />);
    await screen.findByLabelText("Open a PDF or image");
    fireEvent.drop(screen.getByLabelText("Open a PDF or image"), {
      dataTransfer: {
        files: [
          new File(["doc"], "letter.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        ],
      },
    });
    expect(await screen.findByText(/Editor edits text on PDFs and images/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Convert this file" }));
    await waitFor(() => expect(sessionFiles.saveSessionFile).toHaveBeenCalled());
  });

  it("asks guests to sign in before Find text on an image", async () => {
    const user = userEvent.setup();
    render(<PageEditor />);
    await screen.findByLabelText("Open a PDF or image");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["x"], "scan.png", { type: "image/png" }));
    expect(await screen.findByText(/Find text uses AI pages/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Find text on this page" }));
    expect(await screen.findByText("Sign in to convert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start free with Casual" })).toHaveAttribute(
      "href",
      "/login?next=/edit",
    );
    expect(api.extractDocument).not.toHaveBeenCalled();
  });

  it("lets the user click PDF text, type, and download a stamped copy", async () => {
    const user = userEvent.setup();
    render(<PageEditor />);
    await screen.findByLabelText("Open a PDF or image");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "letter.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: 'Edit “Hello”' })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: 'Edit “Hello”' }));
    const field = screen.getByLabelText("Edit text");
    await user.clear(field);
    await user.type(field, "Hi");
    fireEvent.blur(field);
    expect(await screen.findByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Edit “Hi”' })).toHaveTextContent("Hi");
    await user.click(screen.getByRole("button", { name: "Download copy" }));
    await waitFor(() => expect(editorFiles.downloadBlob).toHaveBeenCalled());
  });

  it("commits on Enter and keeps the new text on the box", async () => {
    const user = userEvent.setup();
    render(<PageEditor />);
    await screen.findByLabelText("Open a PDF or image");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "letter.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: 'Edit “Hello”' }));
    const field = screen.getByLabelText("Edit text");
    await user.clear(field);
    await user.type(field, "Date");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Unsaved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: 'Edit “Date”' })).toHaveTextContent("Date");
    expect(screen.queryByLabelText("Edit text")).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Resize se" })).toBeInTheDocument();
  });

  it("lets the user restyle selected text from the style bar", async () => {
    const user = userEvent.setup();
    render(<PageEditor />);
    await screen.findByLabelText("Open a PDF or image");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "letter.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("toolbar", { name: "Text style" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
    await user.click(await screen.findByRole("button", { name: 'Edit “Hello”' }));
    expect(screen.getByRole("button", { name: "Bold" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(await screen.findByText("Unsaved")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Italic" }));
    await user.selectOptions(screen.getByLabelText("Font"), "helvetica");
    expect(screen.getByLabelText("Font")).toHaveValue("helvetica");
  });

  it("inserts a text box and a rectangle on the page", async () => {
    const user = userEvent.setup();
    render(<PageEditor />);
    await screen.findByLabelText("Open a PDF or image");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "letter.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: "Insert text box" }));
    expect(screen.getByLabelText("Edit text")).toHaveValue("Text");
    fireEvent.blur(screen.getByLabelText("Edit text"));
    await user.click(screen.getByRole("button", { name: "Insert rectangle" }));
    expect(screen.getByRole("button", { name: "Rectangle" })).toBeInTheDocument();
    expect(await screen.findByText("Unsaved")).toBeInTheDocument();
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("button", { name: "Rectangle" })).not.toBeInTheDocument();
  });

  it("deletes selected page text with Delete", async () => {
    const user = userEvent.setup();
    render(<PageEditor />);
    await screen.findByLabelText("Open a PDF or image");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "letter.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: 'Edit “Hello”' }));
    await user.keyboard("{Enter}");
    expect(screen.queryByLabelText("Edit text")).not.toBeInTheDocument();
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("button", { name: 'Edit “Hello”' })).not.toBeInTheDocument();
    expect(await screen.findByText("Unsaved")).toBeInTheDocument();
  });

  it("undoes and redoes a text edit", async () => {
    const user = userEvent.setup();
    render(<PageEditor />);
    await screen.findByLabelText("Open a PDF or image");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "letter.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: 'Edit “Hello”' }));
    const field = screen.getByLabelText("Edit text");
    await user.clear(field);
    await user.type(field, "Hi");
    fireEvent.blur(field);
    expect(await screen.findByRole("button", { name: 'Edit “Hi”' })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("button", { name: 'Edit “Hello”' })).toBeInTheDocument();
    expect(screen.queryByText("Unsaved")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(await screen.findByRole("button", { name: 'Edit “Hi”' })).toBeInTheDocument();
    expect(await screen.findByText("Unsaved")).toBeInTheDocument();
  });

  it("undoes an in-progress edit from the keyboard", async () => {
    const user = userEvent.setup();
    render(<PageEditor />);
    await screen.findByLabelText("Open a PDF or image");
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "letter.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: 'Edit “Hello”' }));
    const field = screen.getByLabelText("Edit text");
    await user.clear(field);
    await user.type(field, "Hi");
    fireEvent.keyDown(window, { key: "z", metaKey: true });
    expect(await screen.findByRole("button", { name: 'Edit “Hello”' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "z", metaKey: true, shiftKey: true });
    expect(await screen.findByRole("button", { name: 'Edit “Hi”' })).toBeInTheDocument();
  });
});
