import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Workspace } from "@/components/workspace";
import type { MeResponse } from "@/lib/auth";
import * as api from "@/lib/api";
import { historyCache } from "@/lib/history-cache";
import { setSession } from "@/lib/auth";

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

describe("Workspace", () => {
  beforeEach(() => {
    window.localStorage.clear();
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

  it("lands empty with history visible and only loads blobs on click", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByRole("link", { name: "FileWorks" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Templates" })).toHaveAttribute("href", "/templates");
    expect(screen.getAllByRole("link", { name: "API" })[0]).toHaveAttribute("href", "/docs");
    expect(screen.getByRole("link", { name: "About" })).toHaveAttribute("href", "/about");
    expect(screen.getByText("Drop a file here")).toBeInTheDocument();
    expect(screen.getByText(/Drop a file and convert/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading workspace")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("old.pdf")).toBeInTheDocument());
    expect(document.getElementById("history-panel")?.className).toContain("[grid-area:history]");
    expect(api.fetchHistoryDetail).not.toHaveBeenCalled();
    expect(api.fetchHistoryFile).not.toHaveBeenCalled();

    await user.click(screen.getByText("old.pdf"));
    await waitFor(() => expect(api.fetchHistoryDetail).toHaveBeenCalled());
    expect(api.fetchHistoryFile).toHaveBeenCalled();

    await user.click(screen.getByLabelText("Hide history"));
    expect(screen.queryByLabelText("Hide history")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Show history")).toBeInTheDocument();
    expect(screen.queryByLabelText("Show full history")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Show history"));
    expect(screen.getByLabelText("Hide history")).toBeInTheDocument();
    expect(screen.getAllByText("old.pdf").length).toBeGreaterThan(0);

    await user.click(screen.getByLabelText("Delete old.pdf"));
    await waitFor(() => expect(api.deleteHistoryItem).toHaveBeenCalled());
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
    render(<Workspace />);
    await waitFor(() => expect(screen.getByText("Drop a file here")).toBeInTheDocument());
    expect(screen.queryByLabelText("Loading workspace")).not.toBeInTheDocument();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeDisabled();
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
    await waitFor(() => expect(screen.getByText("Drop a file here")).toBeInTheDocument());
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/login");
    expect(screen.getByText(/to save conversions and see history/i)).toBeInTheDocument();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeDisabled();
    expect(api.fetchHistory).not.toHaveBeenCalled();
  });

  it("reuses cached detail and file on a second click", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByText("old.pdf")).toBeInTheDocument());

    const historyRow = () => screen.getByTitle("old.pdf");
    await user.click(historyRow());
    await waitFor(() => expect(api.fetchHistoryDetail).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.fetchHistoryFile).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("restored")).toBeInTheDocument());

    vi.mocked(api.fetchHistoryDetail).mockClear();
    vi.mocked(api.fetchHistoryFile).mockClear();

    await user.click(historyRow());
    await waitFor(() => expect(screen.getByText("restored")).toBeInTheDocument());
    expect(api.fetchHistoryDetail).not.toHaveBeenCalled();
    expect(api.fetchHistoryFile).not.toHaveBeenCalled();
  });

  it("seeds cache from convert so opening that history row skips detail fetch", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByText("old.pdf")).toBeInTheDocument());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["abc"], "note.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByText("note.png")).toBeInTheDocument());
    await user.click(screen.getByText("Convert"));
    await waitFor(() => expect(screen.getByText("1 page")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTitle("a.png")).toBeInTheDocument());

    vi.mocked(api.fetchHistoryDetail).mockClear();
    vi.mocked(api.fetchHistoryFile).mockClear();

    await user.click(screen.getByTitle("a.png"));
    await waitFor(() => expect(screen.getByText("hi")).toBeInTheDocument());
    expect(api.fetchHistoryDetail).not.toHaveBeenCalled();
    expect(api.fetchHistoryFile).not.toHaveBeenCalled();
  });

  it("converts a new file and prepends it in history", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByText("old.pdf")).toBeInTheDocument());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["abc"], "note.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByText("note.png")).toBeInTheDocument());
    await user.click(screen.getByText("Convert"));
    await waitFor(() => expect(screen.getByText("1 page")).toBeInTheDocument());
    expect(screen.queryByText(/AnyDoc|PP-OCR|Paddle/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("a.png").length).toBeGreaterThan(0));
    expect(screen.getByText("old.pdf")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Hide source"));
    await waitFor(() => expect(screen.getByLabelText("Show source")).toBeInTheDocument());
    expect(screen.queryByText("Show preview")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Show source"));
    expect(screen.getByLabelText("Hide source")).toBeInTheDocument();
  });
});
