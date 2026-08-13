import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Workspace } from "@/components/workspace";
import type { MeResponse } from "@/lib/auth";
import * as api from "@/lib/api";

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
    limit_ai_month: 100,
    remaining_ai_day: null,
    remaining_ai_month: 100,
  },
  google_client_id: null,
};

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
      items: [
        {
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
        },
      ],
      storage_backend: "local",
    })),
    refreshSession: vi.fn(async () => false),
    extractDocument: vi.fn(async () => ({
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
    })),
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
  it("renders, converts, restores history, and toggles panels", async () => {
    const user = userEvent.setup();
    render(<Workspace />);
    await waitFor(() => expect(screen.getByText("FileWorks")).toBeInTheDocument());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["abc"], "note.png", { type: "image/png" }));
    await waitFor(() => expect(screen.getByText("note.png")).toBeInTheDocument());
    await user.click(screen.getByText("Convert"));
    await waitFor(() => expect(screen.getByText("1 page")).toBeInTheDocument());
    expect(screen.queryByText(/AnyDoc|PP-OCR|Paddle/i)).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Show history"));
    await waitFor(() => expect(screen.getByText("old.pdf")).toBeInTheDocument());
    await user.click(screen.getByText("old.pdf"));
    await waitFor(() => expect(api.fetchHistoryDetail).toHaveBeenCalled());
    await user.click(screen.getByLabelText("Delete old.pdf"));
    await waitFor(() => expect(api.deleteHistoryItem).toHaveBeenCalled());

    await user.click(screen.getByLabelText("Hide source preview"));
    await waitFor(() => expect(screen.getByText("Show preview")).toBeInTheDocument());
    await user.click(screen.getByText("Show preview"));
  });
});
