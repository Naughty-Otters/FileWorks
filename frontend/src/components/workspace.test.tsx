import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Workspace } from "@/components/workspace";
import type { MeResponse } from "@/lib/auth";
import * as api from "@/lib/api";
import { historyCache } from "@/lib/history-cache";
import { setSession } from "@/lib/auth";
import * as sessionFiles from "@/lib/workspace-session";
import { PRODUCT } from "@/lib/product-copy";

const guestMe: MeResponse = {
  user: { id: "u1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
  plan: "pro",
  permissions: { extract: true, export: true, "history.read": true, "extract.ai": true },
  quota: {
    used_day: 0,
    used_month: 0,
    limit_day: 10,
    limit_month: null,
    remaining_day: 9,
    remaining_month: null,
    used_ai_day: 0,
    used_ai_month: 0,
    limit_ai_day: null,
    limit_ai_month: 50,
    remaining_ai_day: null,
    remaining_ai_month: 50,
  },
  google_client_id: null,
};

const pastItem = {
  id: "h1",
  filename: "old.pdf",
  content_type: "application/pdf",
  size_bytes: 12,
  created_at: "2026-01-01T12:00:00.000Z",
  engine: "anydoc",
  page_count: 1,
  storage_backend: "local",
  has_markdown: true,
  has_json: false,
};

const convertedSummary = {
  id: "d1",
  filename: "a.png",
  content_type: "image/png",
  size_bytes: 3,
  created_at: "2026-08-15T12:00:00.000Z",
  engine: "ocr",
  page_count: 1,
  storage_backend: "local",
  has_markdown: true,
  has_json: true,
};

const historyState = { items: [pastItem] };

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/dynamic", async () => {
  const { HistoryPanel } = await import("@/components/history-panel");
  return { default: () => HistoryPanel };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    fetchHealth: vi.fn(async () => ({
      status: "ok",
      app: "FileWorks",
      ocr_ready: true,
      ocr_engine: "ocr",
      ocr_error: null,
      storage_backend: "local",
    })),
    fetchMe: vi.fn(async () => guestMe),
    fetchHistory: vi.fn(async () => ({
      items: historyState.items,
      storage_backend: "local",
    })),
    refreshSession: vi.fn(async () => false),
    extractDocument: vi.fn(async () => {
      historyState.items = [convertedSummary, ...historyState.items.filter((item) => item.id !== convertedSummary.id)];
      return {
        id: "d1",
        filename: "a.png",
        content_type: "image/png",
        size_bytes: 3,
        engine: "ocr",
        page_count: 1,
        format: "both",
        markdown: "# hi",
        json: { a: 1 },
        pages: [],
      };
    }),
    deleteHistoryItem: vi.fn(async () => undefined),
    fetchHistoryDetail: vi.fn(async () => ({
      id: "h1",
      filename: "old.pdf",
      content_type: "application/pdf",
      size_bytes: 12,
      created_at: "2026-01-01T12:00:00.000Z",
      engine: "anydoc",
      page_count: 1,
      format: "both",
      markdown: "# restored",
      json: {},
      pages: [],
      storage_backend: "local",
      file_url: "/api/history/h1/file",
    })),
    fetchHistoryFile: vi.fn(async () => new File(["pdf"], "old.pdf", { type: "application/pdf" })),
  };
});

vi.mock("@/lib/prefetch", () => ({
  prefetchHeavyUi: vi.fn(async () => []),
}));

const pastDocxItem = {
  id: "h2",
  filename: "notes.docx",
  content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  size_bytes: 24,
  created_at: "2026-01-02T12:00:00.000Z",
  engine: "anydoc",
  page_count: 1,
  storage_backend: "local",
  has_markdown: true,
  has_json: false,
};

describe("Workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
    historyCache.clear();
    historyState.items = [{ ...pastItem }];
    vi.mocked(api.fetchHistoryDetail).mockClear();
    vi.mocked(api.fetchHistoryFile).mockClear();
    vi.mocked(api.fetchHistory).mockReset();
    vi.mocked(api.fetchHistory).mockImplementation(async () => ({
      items: historyState.items,
      storage_backend: "local",
    }));
    vi.mocked(api.extractDocument).mockClear();
    vi.mocked(api.deleteHistoryItem).mockClear();
    vi.mocked(api.fetchMe).mockReset();
    vi.mocked(api.fetchMe).mockImplementation(async () => guestMe);
  });

  async function openHistory(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() => expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(screen.getByText("old.pdf")).toBeInTheDocument());
  }

  async function chooseProduceFromHistory(user: ReturnType<typeof userEvent.setup>) {
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Produce a Design/i })).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: /Produce a Design/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Convert" })).toBeInTheDocument());
  }

  async function uploadAndProduce(user: ReturnType<typeof userEvent.setup>, file: File) {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);
    const make = await screen
      .findByRole("button", { name: /Produce a Design/i })
      .catch(() => null);
    if (make) await user.click(make);
    await waitFor(() => expect(screen.getByRole("button", { name: /Convert|Fill /i })).toBeInTheDocument());
  }

  it("lands on a home drop zone and opens history on demand", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByRole("link", { name: "FileWorks" })).toBeInTheDocument());
    expect(screen.getAllByRole("link", { name: "Designs" })[0]).toHaveAttribute("href", "/templates");
    expect(screen.getAllByRole("link", { name: "Editor" })[0]).toHaveAttribute("href", "/edit");
    expect(screen.getAllByRole("link", { name: "API" })[0]).toHaveAttribute("href", "/docs");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.getByText(/Drop a file\. Edit the page/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Fix text where it sits/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument();
    expect(screen.queryByText(/You’ll get Markdown/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Loading workspace")).not.toBeInTheDocument();
    expect(document.getElementById("history-panel")).not.toBeInTheDocument();

    await openHistory(user);
    expect(document.getElementById("history-panel")?.className).toContain("[grid-area:history]");
    expect(api.fetchHistoryDetail).not.toHaveBeenCalled();
    expect(api.fetchHistoryFile).not.toHaveBeenCalled();

    await user.click(screen.getByText("old.pdf"));
    await waitFor(() => expect(api.fetchHistoryDetail).toHaveBeenCalled());
    expect(api.fetchHistoryFile).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Edit text on the page/i })).toBeInTheDocument();
    await chooseProduceFromHistory(user);

    await user.click(screen.getByLabelText("Show history"));
    await waitFor(() => expect(screen.getByLabelText("Hide history")).toBeInTheDocument());
    await user.click(screen.getByLabelText("Hide history"));
    expect(screen.queryByLabelText("Hide history")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Show history")).toBeInTheDocument();
    expect(screen.queryByLabelText("Show full history")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Workspace panes" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("Show history"));
    expect(screen.getByLabelText("Hide history")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Workspace panes" })).not.toBeInTheDocument();
    expect(screen.getAllByText("old.pdf").length).toBeGreaterThan(0);

    await user.click(screen.getByLabelText("Delete old.pdf"));
    await waitFor(() => expect(api.deleteHistoryItem).toHaveBeenCalled());
  });

  it("asks Edit vs Produce after a file lands", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "letter.pdf", { type: "application/pdf" }));
    expect(await screen.findAllByText(/What do you want to do/i)).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: /Edit text on the page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Produce a Design/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Produce a Design/i }));
    expect(await screen.findByText(/You’ll get Markdown/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Convert" })).toBeInTheDocument();
  });

  it("keeps a far-left global pane toggle list when any pane is closed", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await openHistory(user);

    expect(screen.queryByRole("navigation", { name: "Workspace panes" })).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Hide history"));
    const toggles = screen.getByRole("navigation", { name: "Workspace panes" });
    expect(toggles.parentElement?.className).toContain("[grid-area:toggles]");
    expect(within(toggles).getByLabelText("Show history")).toHaveAttribute("aria-pressed", "false");
    expect(within(toggles).getByLabelText("Source")).toHaveAttribute("aria-pressed", "true");
    // No history count badge on the closed-pane toggle.
    expect(within(toggles).queryByText(/^\d+$/)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Hide source"));
    await waitFor(() => expect(screen.getByLabelText("Show source")).toBeInTheDocument());
    expect(screen.getByRole("navigation", { name: "Workspace panes" })).toBeInTheDocument();
    expect(screen.getByLabelText("Show history")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Show source")).toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByLabelText("Show history"));
    const panes = screen.getByRole("navigation", { name: "Workspace panes" });
    expect(within(panes).getByRole("button", { name: "History" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(panes).getByLabelText("Show source")).toHaveAttribute("aria-pressed", "false");
    expect(document.getElementById("history-panel")).toBeInTheDocument();
    expect(panes).toBeInTheDocument();

    await user.click(within(panes).getByLabelText("Show source"));
    expect(screen.getByLabelText("Hide source")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Workspace panes" })).not.toBeInTheDocument();
  });

  it("lets signed-in users browse while history loads", async () => {
    setSession("access", "refresh");
    let resolveHistory: (value: { items: typeof pastItem[]; storage_backend: string }) => void = () => undefined;
    vi.mocked(api.fetchHistory).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument());
    expect(screen.queryByLabelText("Loading workspace")).not.toBeInTheDocument();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "History" }));
    resolveHistory({ items: [{ ...pastItem }], storage_backend: "local" });
    await waitFor(() => expect(screen.getByText("old.pdf")).toBeInTheDocument());
  });

  it("shows a usable guest workspace instead of a boot overlay", async () => {
    vi.mocked(api.fetchMe).mockResolvedValue({
      ...guestMe,
      user: null,
      plan: "anonymous",
      permissions: {},
    });
    render(<Workspace />);
    expect(screen.queryByLabelText("Loading workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading history…")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument());
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("button", { name: "History" })).not.toBeInTheDocument();
    expect(screen.getByText(/Drop a file\. Edit the page/i)).toBeInTheDocument();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeDisabled();
    expect(api.fetchHistory).not.toHaveBeenCalled();
  });

  it("applies ?produce= Intent from the Designs library deep link", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/?produce=invoice");
    render(<Workspace />);
    await waitFor(() =>
      expect(screen.getByText(/Drop a file to fill Client invoice/i)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Upload document" })).toHaveTextContent(
      /Choose file for Client invoice/i,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "bill.pdf", { type: "application/pdf" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Fill Client invoice/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/You’ll get Client invoice/i)).toBeInTheDocument();
  });

  it("opens Produce as from the Target Intent control", async () => {
    const user = userEvent.setup();
    vi.mocked(api.fetchMe).mockResolvedValue({
      ...guestMe,
      user: null,
      plan: "anonymous",
      permissions: {},
    });
    render(<Workspace />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument());
    await uploadAndProduce(user, new File(["x"], "note.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Choose a Design" }));
    expect(screen.getByRole("dialog", { name: "Produce as" })).toBeInTheDocument();
    expect(screen.getByRole("listbox", { name: "Starter design" })).toBeInTheDocument();
  });

  it("asks Edit vs Produce when opening a PDF from history", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await openHistory(user);
    await user.click(screen.getByTitle("old.pdf"));
    await waitFor(() => expect(api.fetchHistoryDetail).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Edit text on the page/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Produce a Design/i })).toBeInTheDocument();
    await chooseProduceFromHistory(user);
    expect(await screen.findByText("restored")).toBeInTheDocument();
  });

  it("reuses cached detail and file on a second click", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await openHistory(user);

    const historyRow = () => screen.getByTitle("old.pdf");
    await user.click(historyRow());
    await waitFor(() => expect(api.fetchHistoryDetail).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.fetchHistoryFile).toHaveBeenCalledTimes(1));
    await chooseProduceFromHistory(user);
    await waitFor(() => expect(screen.getByText("restored")).toBeInTheDocument());

    vi.mocked(api.fetchHistoryDetail).mockClear();
    vi.mocked(api.fetchHistoryFile).mockClear();

    await user.click(screen.getByLabelText("Show history"));
    await waitFor(() => expect(screen.getByTitle("old.pdf")).toBeInTheDocument());
    await user.click(historyRow());
    await chooseProduceFromHistory(user);
    await waitFor(() => expect(screen.getByText("restored")).toBeInTheDocument());
    expect(api.fetchHistoryDetail).not.toHaveBeenCalled();
    expect(api.fetchHistoryFile).not.toHaveBeenCalled();
  });

  it("seeds cache from convert so opening that history row skips detail fetch", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await openHistory(user);
    await uploadAndProduce(user, new File(["abc"], "note.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(screen.getByText("1 page")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTitle("a.png")).toBeInTheDocument());

    vi.mocked(api.fetchHistoryDetail).mockClear();
    vi.mocked(api.fetchHistoryFile).mockClear();

    await user.click(screen.getByTitle("a.png"));
    await chooseProduceFromHistory(user);
    await waitFor(() => expect(screen.getByText("hi")).toBeInTheDocument());
    expect(api.fetchHistoryDetail).not.toHaveBeenCalled();
    expect(api.fetchHistoryFile).not.toHaveBeenCalled();
  });

  it("converts a new file and prepends it in history", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await openHistory(user);
    await uploadAndProduce(user, new File(["abc"], "note.png", { type: "image/png" }));
    expect(screen.getByText("old.pdf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(screen.getByText("1 page")).toBeInTheDocument());
    expect(screen.queryByText(/AnyDoc|PP-OCR|Paddle/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("a.png").length).toBeGreaterThan(0));
    expect(screen.getByText("old.pdf")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Hide source"));
    await waitFor(() => expect(screen.getByLabelText("Show source")).toBeInTheDocument());
    expect(screen.getByRole("navigation", { name: "Workspace panes" })).toBeInTheDocument();
    expect(screen.queryByText("Show preview")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Show source"));
    expect(screen.getByLabelText("Hide source")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Workspace panes" })).not.toBeInTheDocument();
  });

  it("opens Editor from the path chooser after upload", async () => {
    const user = userEvent.setup();
    const saveEditor = vi.spyOn(sessionFiles, "saveEditorFile").mockResolvedValue();
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    render(<Workspace />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "letter.pdf", { type: "application/pdf" }));
    await user.click(await screen.findByRole("button", { name: /Edit text on the page/i }));
    await waitFor(() => expect(saveEditor).toHaveBeenCalled());
    expect(assign).toHaveBeenCalledWith("/edit");
  });

  it("returns to the home landing when Replace is clicked on the chooser", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["pdf"], "letter.pdf", { type: "application/pdf" }));
    expect(await screen.findByRole("button", { name: /Produce a Design/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(await screen.findByText(PRODUCT.homeLine)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit text on the page/i })).not.toBeInTheDocument();
  });

  it("asks Edit this document vs Produce when opening a Word file from history", async () => {
    const user = userEvent.setup();
    historyState.items = [{ ...pastDocxItem }];
    vi.mocked(api.fetchHistoryDetail).mockResolvedValueOnce({
      id: "h2",
      filename: "notes.docx",
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      size_bytes: 24,
      created_at: "2026-01-02T12:00:00.000Z",
      engine: "anydoc",
      page_count: 1,
      format: "both",
      markdown: "# notes",
      json: {},
      pages: [],
      storage_backend: "local",
      file_url: "/api/history/h2/file",
    });
    vi.mocked(api.fetchHistoryFile).mockResolvedValueOnce(
      new File(["doc"], "notes.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );

    render(<Workspace />);
    await waitFor(() => expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "History" }));
    await waitFor(() => expect(screen.getByText("notes.docx")).toBeInTheDocument());
    await user.click(screen.getByText("notes.docx"));
    await waitFor(() => expect(api.fetchHistoryDetail).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: /Edit this document/i })).toBeInTheDocument();
    expect(screen.getByText(/no server convert/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Produce a Design/i })).toBeInTheDocument();
  });
});
