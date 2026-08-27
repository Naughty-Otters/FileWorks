import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TextDocumentEditor } from "@/components/text-document-editor";
import * as sessionFiles from "@/lib/workspace-session";
import * as editorFiles from "@/lib/editor-files";

const sessionState = vi.hoisted(() => ({
  me: null as null | {
    user: { id: string; email: string; name: string; picture_url: null; plan: string };
    plan: string;
    permissions: Record<string, boolean>;
    quota: {
      used_day: number;
      used_month: number;
      limit_day: number | null;
      limit_month: number | null;
      remaining_day: number | null;
      remaining_month: number | null;
      used_ai_day: number;
      used_ai_month: number;
      limit_ai_day: number | null;
      limit_ai_month: number | null;
      remaining_ai_day: number | null;
      remaining_ai_month: number | null;
    };
  },
}));

const emptyQuota = {
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
};

vi.mock("@/lib/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/session")>();
  return {
    ...actual,
    useSession: () => ({
      status: "ready",
      me: sessionState.me,
      displayUser: sessionState.me?.user ?? null,
    }),
    reloadSession: vi.fn(async () => sessionState.me),
  };
});

describe("TextDocumentEditor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionState.me = null;
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
        expect(prose?.textContent ?? "").toMatch(/Title|Hello/);
      },
      { timeout: 4000 },
    );
  });

  it("opens a markdown file and saves from source mode on a paid plan", async () => {
    sessionState.me = {
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
      permissions: { "editor.download": true },
      quota: emptyQuota,
    };
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

  it("blocks download without a paid editor.download permission", async () => {
    sessionState.me = {
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
      permissions: { extract: true },
      quota: emptyQuota,
    };
    const user = userEvent.setup();
    const md = new File(["# Title\n\nHello"], "note.md", { type: "text/markdown" });
    vi.spyOn(sessionFiles, "loadEditorFile").mockResolvedValue(md);

    render(<TextDocumentEditor />);
    expect(await screen.findByText("note.md")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save as" }));
    expect(await screen.findByText("Save on Daily or Expert")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose Daily" })).toHaveAttribute("href", "/pricing");
    expect(editorFiles.downloadBlob).not.toHaveBeenCalled();
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
