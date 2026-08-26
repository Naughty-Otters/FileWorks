import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HistoryPanel } from "@/components/history-panel";
import { MarkdownToolbar, MarkdownToolbarToggle } from "@/components/markdown-toolbar";
import { ThemeToggle } from "@/components/theme-toggle";
import { ThemeProvider } from "@/components/theme-provider";
import { AnnotatedImage, RegionList } from "@/components/region-overlay";
import { UploadPanel } from "@/components/upload-panel";
import { ExtractOptionsPanel } from "@/components/extract-options-panel";
import { ConvertControls, TargetFormatDialog } from "@/components/convert-controls";
import { AuthBar } from "@/components/auth-bar";
import { GoogleSignIn } from "@/components/google-sign-in";
import { LoginScreen, loginRedirectPath } from "@/components/login-screen";
import { ProfilePage } from "@/components/profile-page";
import { PricingPage } from "@/components/pricing-page";
import { LegalPage } from "@/components/legal-page";
import { AboutPage } from "@/components/about-page";
import { ApiPage } from "@/components/api-page";
import { ResultPanel } from "@/components/result-panel";
import { EditableMarkdownPreview, type MarkdownPreviewHandle } from "@/components/editable-markdown-preview";
import { DEFAULT_EXTRACT_OPTIONS, type MeResponse } from "@/lib/api";
import { LINES_PER_PAGE, PAGES_PER_VIEW } from "@/lib/markdown-pages";
import * as api from "@/lib/api";
import { clearSession, setSession } from "@/lib/auth";
import * as gis from "@/lib/google-gis";

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("next/dynamic", () => ({
  default: (loader: () => Promise<Record<string, unknown>>) => {
    let Resolved: React.ComponentType<Record<string, unknown>> | null = null;
    void loader().then((mod) => {
      const value = (mod.default || Object.values(mod).find((item) => typeof item === "function")) as
        | React.ComponentType<Record<string, unknown>>
        | undefined;
      Resolved = value || (() => null);
    });
    return function DynamicMock(props: Record<string, unknown>) {
      if (!Resolved) return null;
      return <Resolved {...props} />;
    };
  },
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

describe("HistoryPanel", () => {
  const item = {
    id: "1",
    filename: "doc.pdf",
    content_type: "application/pdf",
    size_bytes: 1200,
    created_at: "2026-01-01T12:00:00.000Z",
    engine: "anydoc",
    page_count: 2,
    storage_backend: "local",
    has_markdown: true,
    has_json: false,
  };

  it("renders empty and item states", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onDelete = vi.fn();
    const onCollapse = vi.fn();
    const { rerender } = render(
      <HistoryPanel items={[]} selectedId={null} requiresLogin onSelect={onSelect} onDelete={onDelete} />,
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.getByText(/to save conversions and see history/i)).toBeInTheDocument();
    rerender(
      <HistoryPanel
        items={[item]}
        selectedId="1"
        onSelect={onSelect}
        onDelete={onDelete}
        onCollapse={onCollapse}
        storageBackend="local"
      />,
    );
    await user.click(screen.getByText("doc.pdf"));
    expect(onSelect).toHaveBeenCalledWith("1");
    expect(screen.queryByText(/anydoc|AnyDoc|PP-OCR/i)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Hide history"));
    expect(onCollapse).toHaveBeenCalled();
  });
});

describe("MarkdownToolbar", () => {
  it("fires commands", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(<MarkdownToolbar onCommand={onCommand} />);
    await user.click(screen.getByTitle("Bold"));
    expect(onCommand).toHaveBeenCalledWith("bold");
    await user.click(screen.getByTitle("Italic"));
    await user.click(screen.getByTitle("Heading 1"));
    await user.click(screen.getByTitle("Bullet list"));
    await user.click(screen.getByTitle("Numbered list"));
    await user.click(screen.getByTitle("Quote"));
    await user.click(screen.getByTitle("Strikethrough"));
    await user.click(screen.getByTitle("Inline code"));
    await user.click(screen.getByTitle("Heading 2"));
    await user.click(screen.getByTitle("Heading 3"));
    await user.click(screen.getByTitle("Smaller image"));
    await user.click(screen.getByTitle("Image left"));
    await user.click(screen.getByTitle("Image right"));
    await user.click(screen.getByTitle("Image inline"));
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com");
    await user.click(screen.getByTitle("Insert link"));
    expect(onCommand).toHaveBeenCalledWith("link", { url: "https://example.com" });
  });

  it("toggles formatting toolbar from a single chrome control", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(<MarkdownToolbarToggle pressed onToggle={onToggle} />);
    const hide = screen.getByRole("button", { name: "Hide formatting toolbar" });
    expect(hide).toHaveAttribute("aria-pressed", "true");
    await user.click(hide);
    expect(onToggle).toHaveBeenCalled();
    rerender(<MarkdownToolbarToggle pressed={false} onToggle={onToggle} />);
    const show = screen.getByRole("button", { name: "Show formatting toolbar" });
    expect(show).toHaveAttribute("aria-pressed", "false");
    await user.click(show);
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("wraps onto extra rows instead of scrolling sideways", () => {
    render(<MarkdownToolbar onCommand={vi.fn()} />);
    const bar = screen.getByTitle("Bold").closest("div")?.parentElement;
    expect(bar?.className).toContain("flex-wrap");
    expect(bar?.className).not.toContain("overflow-x-auto");
  });
});

describe("ThemeToggle", () => {
  it("renders a theme button", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const button = screen.getByRole("button");
    expect(button).toBeInTheDocument();
    await user.click(button);
  });
});

describe("Region overlay", () => {
  it("lists regions and draws boxes", async () => {
    const user = userEvent.setup();
    const onActiveChange = vi.fn();
    render(
      <RegionList
        regions={[{ id: "r1", page: 1, label: "text", text: "Hello", bbox: [0, 0, 1, 1] }]}
        activeId={null}
        onActiveChange={onActiveChange}
      />,
    );
    await user.click(screen.getByText("Hello"));
    expect(onActiveChange).toHaveBeenCalled();
    render(<RegionList regions={[]} activeId={null} onActiveChange={onActiveChange} />);
    expect(screen.getByText(/No layout regions/i)).toBeInTheDocument();
    render(
      <AnnotatedImage
        src="data:image/png;base64,aa"
        alt="page"
        regions={[{ id: "r1", page: 1, label: "text", text: "Hello", bbox: [0, 0, 10, 10] }]}
        imageSize={{ width: 20, height: 20 }}
        activeId="r1"
        onActiveChange={onActiveChange}
      />,
    );
    expect(screen.getByAltText("page")).toBeInTheDocument();
  });
});

describe("UploadPanel", () => {
  it("accepts a dropped file and can clear it", async () => {
    const user = userEvent.setup();
    const onFileSelect = vi.fn();
    const { rerender } = render(
      <UploadPanel file={null} previewUrl={null} onFileSelect={onFileSelect} onCollapse={vi.fn()} />,
    );
    expect(screen.getByLabelText("Upload document")).toBeInTheDocument();
    fireEvent.dragEnter(screen.getByLabelText("Upload document"));
    fireEvent.dragOver(screen.getByLabelText("Upload document"));
    fireEvent.dragLeave(screen.getByLabelText("Upload document"));
    fireEvent.drop(screen.getByLabelText("Upload document"), {
      dataTransfer: { files: [new File(["abc"], "dropped.png", { type: "image/png" })] },
    });
    expect(onFileSelect).toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Upload document"), { key: "Enter" });
    const file = new File(["abc"], "note.png", { type: "image/png" });
    rerender(
      <UploadPanel
        file={file}
        previewUrl="blob:mock"
        onFileSelect={onFileSelect}
        onCollapse={vi.fn()}
        regions={[{ id: "r1", page: 1, label: "text", text: "Hi", bbox: [0, 0, 1, 1] }]}
        imageSize={{ width: 10, height: 10 }}
      />,
    );
    expect(screen.getByText("note.png")).toBeInTheDocument();
    await user.click(screen.getByLabelText("New source"));
    expect(onFileSelect).toHaveBeenCalledWith(null);
  });

  it("empty source invites a file drop", async () => {
    render(
      <UploadPanel
        file={null}
        previewUrl={null}
        onFileSelect={vi.fn()}
        onCollapse={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/Drop a file\. Choose what to produce/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Choose what to produce on the right/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload document" })).toBeInTheDocument();
  });

  it("previews a markdown file and accepts txt/md in the picker", async () => {
    const file = new File(["# Hello notes"], "note.md", { type: "text/markdown" });
    render(<UploadPanel file={file} previewUrl={null} onFileSelect={vi.fn()} />);
    expect(screen.getByText("note.md")).toBeInTheDocument();
    expect(await screen.findByText("# Hello notes")).toBeInTheDocument();
    const picker = document.querySelector('input[type="file"]');
    expect(picker?.getAttribute("accept")).toContain(".txt");
    expect(picker?.getAttribute("accept")).toContain(".md");
  });
});

describe("ExtractOptionsPanel", () => {
    it("toggles options in embedded and collapsible modes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { unmount } = render(
      <ExtractOptionsPanel options={DEFAULT_EXTRACT_OPTIONS} onChange={onChange} embedded hideKeys={["use_ai"]} />,
    );
    await user.click(screen.getByText("Table recognition"));
    expect(onChange).toHaveBeenCalled();
    unmount();
    render(<ExtractOptionsPanel options={DEFAULT_EXTRACT_OPTIONS} onChange={onChange} />);
    await user.click(screen.getByText(/Parse options/));
    expect(screen.getAllByText("Doc preprocessor").length).toBeGreaterThan(0);
    expect(screen.getByText("Preserve images")).toBeInTheDocument();
    expect(screen.getByText("Keep original charts and figures next to the extracted text")).toBeInTheDocument();
    expect(screen.getByText("Uses AI to read images and scanned PDFs")).toBeInTheDocument();
    expect(screen.queryByText(/Vision LLM/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/API key/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AnyDoc/i)).not.toBeInTheDocument();
  });
});

describe("ConvertControls", () => {
  it("defaults target format to Markdown via Produce as dialog", () => {
    render(
      <TargetFormatDialog
        outputLayout="standard"
        designTargets={[
          {
            id: "builtin:invoice",
            name: "Client invoice",
            description: "Bill-to and totals",
            category: "business",
          },
        ]}
        templates={[]}
        returnFileType="pdf"
        templateNeedsAi={false}
        wantsReadAi={false}
        onClose={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Output layout")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Produce as" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Markdown/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Starter design/i })).toBeInTheDocument();
    const starterList = screen.getByRole("listbox", { name: "Starter design" });
    expect(starterList).toBeInTheDocument();
    expect(within(starterList).getByRole("option", { name: /Client invoice/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("filters starter designs by category chip and search", async () => {
    const user = userEvent.setup();
    const onOutputLayoutChange = vi.fn();
    render(
      <TargetFormatDialog
        outputLayout="standard"
        onOutputLayoutChange={onOutputLayoutChange}
        designTargets={[
          {
            id: "builtin:invoice",
            name: "Client invoice",
            description: "Bill-to and totals",
            category: "business",
          },
          {
            id: "builtin:family_daily",
            name: "Daily family schedule",
            description: "Fridge-ready day card",
            category: "family",
          },
          {
            id: "builtin:report",
            name: "Markdown report",
            description: "Page layout for extracted Markdown",
            category: "reports",
          },
        ]}
        templates={[]}
        returnFileType="pdf"
        templateNeedsAi={false}
        wantsReadAi={false}
        onClose={vi.fn()}
      />,
    );

    const list = screen.getByRole("listbox", { name: "Starter design" });
    expect(within(list).getByText("Bill-to and totals")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Family" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Business" })).toBeInTheDocument();
    // Only categories present in the passed options are shown as chips.

    await user.click(screen.getByRole("button", { name: "Family" }));
    expect(within(list).getByRole("option", { name: /Daily family schedule/i })).toBeInTheDocument();
    expect(within(list).queryByRole("option", { name: /Client invoice/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Business" }));
    expect(within(list).getByRole("option", { name: /Client invoice/i })).toBeInTheDocument();
    expect(within(list).queryByRole("option", { name: /Daily family schedule/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByPlaceholderText("Search designs…"), "invoice");
    expect(within(list).getByRole("option", { name: /Client invoice/i })).toBeInTheDocument();
    expect(within(list).queryByRole("option", { name: /Daily family schedule/i })).not.toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search designs…"));
    await user.type(screen.getByPlaceholderText("Search designs…"), "zzzz-no-match");
    expect(within(list).getByText("No designs match.")).toBeInTheDocument();

    await user.clear(screen.getByPlaceholderText("Search designs…"));
    await user.type(screen.getByPlaceholderText("Search designs…"), "invoice");
    await user.click(within(list).getByRole("option", { name: /Client invoice/i }));
    expect(onOutputLayoutChange).toHaveBeenCalledWith("builtin:invoice");
  });

  it("selects a starter Intent from the Produce as dialog", async () => {
    const user = userEvent.setup();
    const onOutputLayoutChange = vi.fn();
    render(
      <TargetFormatDialog
        outputLayout="standard"
        onOutputLayoutChange={onOutputLayoutChange}
        designTargets={[
          {
            id: "builtin:timesheet",
            name: "Timesheet",
            description: "Employee hours by project",
            category: "business",
          },
        ]}
        templates={[]}
        returnFileType="pdf"
        templateNeedsAi={false}
        wantsReadAi={false}
        onClose={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("option", { name: /Timesheet/i }));
    expect(onOutputLayoutChange).toHaveBeenCalledWith("builtin:timesheet");
  });

  it("uses Fill label when a starter Intent is selected", async () => {
    const user = userEvent.setup();
    render(
      <ConvertControls
        options={DEFAULT_EXTRACT_OPTIONS}
        onChange={vi.fn()}
        me={guestMe}
        health={null}
        loading={false}
        canExtract={false}
        fileReady
        quotaBlocked={false}
        onConvert={vi.fn()}
        onStop={vi.fn()}
        outputLayout="builtin:invoice"
        designTargets={[
          {
            id: "builtin:invoice",
            name: "Client invoice",
            description: "Bill-to and totals",
            category: "business",
          },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Fill Client invoice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fill Client invoice" })).toHaveTextContent("");
    await user.click(screen.getByRole("button", { name: "Fill Client invoice" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Sign in to convert")).toBeInTheDocument();
  });

  it("converts and opens options", async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    const onChange = vi.fn();
    render(
      <ConvertControls
        options={{ ...DEFAULT_EXTRACT_OPTIONS, use_ai: true }}
        onChange={onChange}
        me={{
          ...guestMe,
          user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
          permissions: { "extract.ai": true, "extract.translate": true },
        }}
        health={{
          status: "ok",
          app: "FileWorks",
          ocr_ready: true,
          ocr_engine: "ocr",
          ocr_error: null,
          storage_backend: "local",
          llm_ready: true,
          translate_ready: true,
          translate_languages: [
            { id: "original", label: "Original (no translation)" },
            { id: "en", label: "English" },
          ],
        }}
        loading={false}
        canExtract
        fileReady
        quotaBlocked={false}
        onConvert={onConvert}
        onStop={vi.fn()}
      />,
    );
    const run = screen.getByRole("button", { name: "AI Convert" });
    expect(run).toHaveTextContent("");
    await user.click(run);
    expect(onConvert).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Options" }));
    await user.click(screen.getByText("Read with AI"));
    expect(screen.queryByText(/AnyDoc/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/openai/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vision providers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PP-OCR/i)).not.toBeInTheDocument();
  });

  it("shows stop while loading", async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    render(
      <ConvertControls
        options={DEFAULT_EXTRACT_OPTIONS}
        onChange={vi.fn()}
        me={guestMe}
        health={null}
        loading
        canExtract={false}
        quotaBlocked={false}
        onConvert={vi.fn()}
        onStop={onStop}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Stop conversion" }));
    expect(onStop).toHaveBeenCalled();
  });

  it("shows a plan policy popup when a guest clicks convert", async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    render(
      <ConvertControls
        options={DEFAULT_EXTRACT_OPTIONS}
        onChange={vi.fn()}
        me={guestMe}
        health={null}
        loading={false}
        canExtract={false}
        fileReady
        quotaBlocked={false}
        onConvert={onConvert}
        onStop={vi.fn()}
      />,
    );
    const convert = screen.getByRole("button", { name: "Convert" });
    expect(convert).toBeEnabled();
    expect(convert).toHaveTextContent("");
    await user.click(convert);
    expect(onConvert).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Sign in to convert" })).toBeInTheDocument();
    expect(screen.getByText(/Free · Casual/i)).toBeInTheDocument();
    expect(screen.getByText("30 conversions / day")).toBeInTheDocument();
    expect(screen.getByText("30 files / day")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start free with Casual" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /See Free Casual/i })).toHaveAttribute("href", "/pricing");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(convert);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("lets a basic account convert", async () => {
    const user = userEvent.setup();
    const onConvert = vi.fn();
    render(
      <ConvertControls
        options={DEFAULT_EXTRACT_OPTIONS}
        onChange={vi.fn()}
        me={{
          ...guestMe,
          user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
          plan: "basic",
          permissions: { extract: true, export: true, "history.read": true },
          quota: { ...guestMe.quota, limit_day: 1, remaining_day: 1 },
        }}
        health={null}
        loading={false}
        canExtract
        fileReady
        quotaBlocked={false}
        onConvert={onConvert}
        onStop={vi.fn()}
      />,
    );
    const convert = screen.getByRole("button", { name: "Convert" });
    expect(convert).toBeEnabled();
    await user.click(convert);
    expect(onConvert).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains a reached daily quota in the policy popup", async () => {
    const user = userEvent.setup();
    render(
      <ConvertControls
        options={DEFAULT_EXTRACT_OPTIONS}
        onChange={vi.fn()}
        me={{
          ...guestMe,
          user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
          plan: "basic",
          permissions: { extract: true },
          quota: { ...guestMe.quota, limit_day: 1, remaining_day: 0 },
        }}
        health={null}
        loading={false}
        canExtract={false}
        fileReady
        quotaBlocked
        onConvert={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Convert" }));
    expect(screen.getByRole("dialog", { name: "Today's conversion limit reached" })).toBeInTheDocument();
  });

  it("explains a reached monthly quota in the policy popup", async () => {
    const user = userEvent.setup();
    render(
      <ConvertControls
        options={DEFAULT_EXTRACT_OPTIONS}
        onChange={vi.fn()}
        me={{
          ...guestMe,
          user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
          plan: "pro",
          permissions: { extract: true },
          quota: { ...guestMe.quota, limit_month: 100, remaining_month: 0 },
        }}
        health={null}
        loading={false}
        canExtract={false}
        fileReady
        quotaBlocked
        onConvert={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Convert" }));
    expect(screen.getByRole("dialog", { name: "Monthly conversion limit reached" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("Dismiss"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("explains a reached AI quota in the policy popup", async () => {
    const user = userEvent.setup();
    render(
      <ConvertControls
        options={{ ...DEFAULT_EXTRACT_OPTIONS, use_ai: true }}
        onChange={vi.fn()}
        me={{
          ...guestMe,
          user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
          plan: "pro",
          permissions: { extract: true, "extract.ai": true, "extract.translate": true },
          quota: {
            ...guestMe.quota,
            limit_month: 100,
            remaining_month: 50,
            used_ai_month: 50,
            limit_ai_month: 50,
            remaining_ai_month: 0,
          },
        }}
        health={null}
        loading={false}
        canExtract
        fileReady
        quotaBlocked={false}
        onConvert={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "AI Convert" }));
    expect(screen.getByRole("dialog", { name: "Monthly AI allowance reached" })).toBeInTheDocument();
    expect(screen.getByText(/500 AI pages \/ month/)).toBeInTheDocument();
  });
});

describe("AuthBar", () => {
  const ada = { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" };

  it("treats an unknown session as a guest so first-time visitors see Sign in", () => {
    render(<AuthBar me={null} status="unknown" user={null} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByRole("link", { name: "Account" })).not.toBeInTheDocument();
  });

  it("paints the cached avatar before the profile arrives", () => {
    render(<AuthBar me={null} status="signed-in" user={ada} />);
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/profile");
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
  });

  it("keeps initials behind the photo so the circle is never blank", () => {
    render(
      <AuthBar me={null} status="signed-in" user={{ ...ada, picture_url: "https://example.com/a.png" }} />,
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(document.querySelector('img[src="https://example.com/a.png"]')).toBeInTheDocument();
  });

  it("links guests to the login page without an inline Google button", () => {
    render(<AuthBar me={{ ...guestMe, google_client_id: "cid.apps.googleusercontent.com" }} />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByTestId("google-sign-in")).not.toBeInTheDocument();
  });

  it("shows signed-in user", () => {
    render(
      <AuthBar
        me={{
          ...guestMe,
          user: { id: "1", email: "a@b.co", name: "Ada", picture_url: "https://example.com/a.png", plan: "pro" },
          plan: "pro",
          quota: { ...guestMe.quota, limit_day: 5, used_day: 1 },
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/profile");
    expect(screen.getByTitle("Ada · Daily · 1/5 today")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sign out")).not.toBeInTheDocument();
  });

  it("summarizes name plan and quota on the avatar", () => {
    render(
      <AuthBar
        me={{
          ...guestMe,
          user: { id: "1", email: "a@b.co", name: null, picture_url: null, plan: "premium" },
          plan: "premium",
          quota: { ...guestMe.quota, limit_month: 500, used_month: 12 },
        }}
      />,
    );
    expect(screen.getByRole("link", { name: "Account" })).toHaveAttribute("href", "/profile");
    expect(screen.getByTitle("a@b.co · Expert · 12/500 this month")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });
});

describe("GoogleSignIn", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.google;
  });
  it("completes login from a GIS credential", async () => {
    const initialize = vi.fn();
    const renderButton = vi.fn();
    const cancel = vi.fn();
    window.google = { accounts: { id: { initialize, renderButton, cancel } } };
    const signedIn = vi.fn();
    const nextMe = { ...guestMe, user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" } };
    vi.spyOn(api, "loginWithGoogle").mockResolvedValue(nextMe);
    const { unmount } = render(
      <GoogleSignIn clientId="cid.apps.googleusercontent.com" onSignedIn={signedIn} size="large" />,
    );
    await waitFor(() => expect(initialize).toHaveBeenCalled());
    expect(renderButton).toHaveBeenCalled();
    const callback = initialize.mock.calls.at(-1)?.[0].callback as (resp: { credential: string }) => Promise<void>;
    await callback({ credential: "id-token" });
    expect(api.loginWithGoogle).toHaveBeenCalledWith("id-token");
    expect(signedIn).toHaveBeenCalledWith(nextMe);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });

  it("shows errors when GIS or login fails", async () => {
    const initialize = vi.fn();
    window.google = {
      accounts: { id: { initialize, renderButton: vi.fn(), prompt: vi.fn() } },
    };
    vi.spyOn(api, "loginWithGoogle").mockRejectedValue(new Error("nope"));
    render(<GoogleSignIn clientId="cid" onSignedIn={vi.fn()} />);
    await waitFor(() => expect(initialize).toHaveBeenCalled());
    const callback = initialize.mock.calls.at(-1)?.[0].callback as (resp: { credential: string }) => Promise<void>;
    await callback({ credential: "" });
    expect(await screen.findByText(/did not return a sign-in credential/i)).toBeInTheDocument();
    await callback({ credential: "bad" });
    expect(await screen.findByText("nope")).toBeInTheDocument();
  });

  it("explains when the client id is missing", () => {
    render(<GoogleSignIn clientId="" onSignedIn={vi.fn()} />);
    expect(screen.getByText(/not configured/i)).toBeInTheDocument();
  });

  it("shows a load error when GIS is blocked", async () => {
    vi.spyOn(gis, "loadGoogleIdentity").mockRejectedValue(new Error("blocked"));
    render(<GoogleSignIn clientId="cid" onSignedIn={vi.fn()} />);
    expect(await screen.findByText("blocked")).toBeInTheDocument();
  });
});

describe("LoginScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("renders the sign-in card and guest escape hatch", async () => {
    vi.spyOn(api, "fetchMe").mockResolvedValue(guestMe);
    render(<LoginScreen />);
    expect(screen.getByText("Sign in")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue as guest" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /See Free Casual/i })).toHaveAttribute("href", "/pricing");
    expect(screen.getByText(/Free · Casual/i)).toBeInTheDocument();
    expect(screen.getByText(/thirty conversions a day/i)).toBeInTheDocument();
    await waitFor(() => expect(api.fetchMe).toHaveBeenCalled());
  });

  it("stays on the page when session check fails", async () => {
    vi.spyOn(api, "fetchMe").mockRejectedValue(new Error("offline"));
    render(<LoginScreen />);
    expect(await screen.findByText("Sign in")).toBeInTheDocument();
    expect(await screen.findByText(/not configured/i)).toBeInTheDocument();
  });

  it("redirects when the session is already signed in", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, search: "?next=/workspace" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
    });
    render(<LoginScreen />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/workspace"));
  });

  it("leaves the login page when a stored session shows up on refocus", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, search: "?next=/history" });
    const me = vi.spyOn(api, "fetchMe").mockResolvedValue(guestMe);
    render(<LoginScreen />);
    await waitFor(() => expect(me).toHaveBeenCalled());
    expect(assign).not.toHaveBeenCalled();

    setSession("access", "refresh");
    me.mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
    });
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/history"));
    clearSession();
  });

  it("only allows same-origin next paths", () => {
    expect(loginRedirectPath("")).toBe("/");
    expect(loginRedirectPath("?next=/history")).toBe("/history");
    expect(loginRedirectPath("?next=https://evil.example")).toBe("/");
    expect(loginRedirectPath("?next=//evil.example")).toBe("/");
  });

  it("falls back to the page that linked to /login", () => {
    const origin = window.location.origin;
    expect(loginRedirectPath("", `${origin}/pricing?plan=pro`)).toBe("/pricing?plan=pro");
    expect(loginRedirectPath("", `${origin}/login`)).toBe("/");
    expect(loginRedirectPath("", "https://evil.example/steal")).toBe("/");
    expect(loginRedirectPath("", "not a url")).toBe("/");
  });
});

describe("PricingPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists dollar prices and syncs sign-in with the workspace session", async () => {
    vi.spyOn(api, "fetchMe").mockResolvedValue(guestMe);
    vi.spyOn(api, "fetchBillingCatalog").mockResolvedValue({
      enabled: false,
      currency: "usd",
      amounts: { basic: 0, pro: 5, premium: 29 },
      prices: { basic: false, pro: false, premium: false },
    });
    render(<PricingPage />);
    expect(await screen.findByText("Prices and roles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose Daily" })).toHaveAttribute("href", "/login?next=%2Fpricing");
    expect(screen.getByRole("link", { name: "Start free with Casual" })).toHaveAttribute(
      "href",
      "/login?next=%2Fpricing",
    );
    expect(screen.getAllByText("Free").length).toBeGreaterThan(2);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Fpricing");
    expect(screen.getByText("Role comparison")).toBeInTheDocument();
    expect(screen.getAllByText("$5 / month").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$29 / month").length).toBeGreaterThan(0);
    expect(screen.getAllByText("500 AI pages / month").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5,000 AI pages / month").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Refunds" })).toHaveAttribute("href", "/legal#refunds");
    expect(screen.getByRole("link", { name: "Cancellation" })).toHaveAttribute("href", "/legal#cancellation");
  });

  it("starts Stripe checkout for a signed-in account", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, search: "" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
    });
    vi.spyOn(api, "fetchBillingCatalog").mockResolvedValue({
      enabled: true,
      currency: "usd",
      amounts: { basic: 0, pro: 5, premium: 29 },
      prices: { basic: false, pro: true, premium: true },
    });
    vi.spyOn(api, "startCheckout").mockResolvedValue({
      url: "https://checkout.stripe.test/cs",
      updated: false,
      plan: "pro",
    });
    render(<PricingPage />);
    await user.click(await screen.findByRole("button", { name: "Upgrade to Daily" }));
    expect(api.startCheckout).toHaveBeenCalledWith("pro", "/pricing");
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs");
  });

  it("shows the workspace avatar when signed in", async () => {
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: "https://example.com/a.png", plan: "pro" },
      plan: "pro",
    });
    vi.spyOn(api, "fetchBillingCatalog").mockResolvedValue({
      enabled: true,
      currency: "usd",
      amounts: { basic: 0, pro: 5, premium: 29 },
      prices: { basic: false, pro: true, premium: true },
    });
    render(<PricingPage />);
    expect(await screen.findByRole("link", { name: "Account" })).toHaveAttribute("href", "/profile");
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.getByText("Current role")).toBeInTheDocument();
  });

  it("lets a paid account switch to the other paid plan", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, search: "" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "premium" },
      plan: "premium",
    });
    vi.spyOn(api, "fetchBillingCatalog").mockResolvedValue({
      enabled: true,
      currency: "usd",
      amounts: { basic: 0, pro: 5, premium: 29 },
      prices: { basic: false, pro: true, premium: true },
    });
    vi.spyOn(api, "startCheckout").mockResolvedValue({
      url: "https://checkout.stripe.test/cs_switch",
      updated: false,
      plan: "pro",
    });
    render(<PricingPage />);
    await user.click(await screen.findByRole("button", { name: "Switch to Daily" }));
    expect(api.startCheckout).toHaveBeenCalledWith("pro", "/pricing");
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs_switch");
  });

  it("confirms checkout then syncs the paid role", async () => {
    vi.stubGlobal("location", { assign: vi.fn(), search: "?checkout=success&session_id=cs_1" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
    });
    vi.spyOn(api, "fetchBillingCatalog").mockResolvedValue({
      enabled: true,
      currency: "usd",
      amounts: { basic: 0, pro: 5, premium: 29 },
      prices: { basic: false, pro: true, premium: true },
    });
    vi.spyOn(api, "confirmCheckout").mockResolvedValue({ plan: "pro" });
    vi.spyOn(api, "syncBilling").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
    });
    render(<PricingPage />);
    expect(await screen.findByText("Payment received. Your role is updated.")).toBeInTheDocument();
    expect(api.confirmCheckout).toHaveBeenCalledWith("cs_1");
    expect(api.syncBilling).toHaveBeenCalled();
  });

  it("falls back to sync when checkout confirm fails", async () => {
    vi.stubGlobal("location", { assign: vi.fn(), search: "?checkout=success&session_id=cs_1" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
    });
    vi.spyOn(api, "fetchBillingCatalog").mockResolvedValue({
      enabled: true,
      currency: "usd",
      amounts: { basic: 0, pro: 5, premium: 29 },
      prices: { basic: false, pro: true, premium: true },
    });
    vi.spyOn(api, "confirmCheckout").mockRejectedValue(new Error("confirm failed"));
    vi.spyOn(api, "syncBilling").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
    });
    render(<PricingPage />);
    expect(await screen.findByText("Payment received. Your role updates when Stripe confirms the subscription.")).toBeInTheDocument();
    expect(api.syncBilling).toHaveBeenCalled();
  });

  it("explains a canceled checkout and a missing Stripe URL", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, search: "?checkout=cancel" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
    });
    vi.spyOn(api, "fetchBillingCatalog").mockResolvedValue({
      enabled: true,
      currency: "usd",
      amounts: { basic: 0, pro: 5, premium: 29 },
      prices: { basic: false, pro: true, premium: true },
    });
    vi.spyOn(api, "startCheckout").mockResolvedValue({ url: null, updated: false, plan: "pro" });
    render(<PricingPage />);
    expect(await screen.findByText(/Checkout canceled — no charge/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upgrade to Daily" }));
    expect(await screen.findByText("Stripe did not return a billing URL")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });

  it("syncs Stripe after returning from a plan-change confirmation", async () => {
    vi.stubGlobal("location", { assign: vi.fn(), search: "?billing=return" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
    });
    vi.spyOn(api, "fetchBillingCatalog").mockResolvedValue({
      enabled: true,
      currency: "usd",
      amounts: { basic: 0, pro: 5, premium: 29 },
      prices: { basic: false, pro: true, premium: true },
    });
    vi.spyOn(api, "syncBilling").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "premium" },
      plan: "premium",
      billing: { enabled: true, prices: { basic: false, pro: true, premium: true } },
    });
    render(<PricingPage />);
    expect(await screen.findByText("Billing updated from Stripe.")).toBeInTheDocument();
    expect(api.syncBilling).toHaveBeenCalled();
  });

  it("shows a pending cancellation after portal return and a stale-sync fallback", async () => {
    vi.stubGlobal("location", { assign: vi.fn(), search: "?billing=return" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
    });
    vi.spyOn(api, "fetchBillingCatalog").mockResolvedValue({
      enabled: true,
      currency: "usd",
      amounts: { basic: 0, pro: 5, premium: 29 },
      prices: { basic: false, pro: true, premium: true },
    });
    vi.spyOn(api, "syncBilling").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
      billing: {
        enabled: true,
        prices: { basic: false, pro: true, premium: true },
        cancel_at_period_end: true,
        current_period_end: "2030-01-01T00:00:00+00:00",
      },
    });
    const { unmount } = render(<PricingPage />);
    expect(await screen.findByText(/This role stays until the period ends/)).toBeInTheDocument();
    unmount();
    vi.spyOn(api, "syncBilling").mockRejectedValue(new Error("sync failed"));
    render(<PricingPage />);
    expect(await screen.findByText("Returned from Stripe. Refresh if your role looks stale.")).toBeInTheDocument();
  });

  it("disables a downgrade on pricing when usage exceeds the lower plan", async () => {
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "premium" },
      plan: "premium",
      quota: { ...guestMe.quota, used_day: 50, used_ai_month: 600 },
    });
    vi.spyOn(api, "fetchBillingCatalog").mockResolvedValue({
      enabled: true,
      currency: "usd",
      amounts: { basic: 0, pro: 5, premium: 29 },
      prices: { basic: false, pro: true, premium: true },
    });
    render(<PricingPage />);
    expect(await screen.findByRole("button", { name: "Switch to Daily" })).toBeDisabled();
    expect(screen.getByText(/Usage is over this plan/)).toBeInTheDocument();
  });
});

describe("LegalPage", () => {
  it("publishes Stripe-required business details", () => {
    render(<LegalPage />);
    expect(screen.getByRole("heading", { name: "Business and services" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Customer service contact details" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Return policy and process" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Refund and dispute policy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cancellation policy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Legal and export restrictions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Terms and conditions of promotions" })).toBeInTheDocument();
    expect(screen.getAllByText("support@fileworks.ai").length).toBeGreaterThan(0);
    expect(screen.getAllByText("https://fileworks.ai").length).toBeGreaterThan(0);
  });
});

describe("AboutPage", () => {
  it("lists the business, services, and products without requiring sign-in", () => {
    render(<AboutPage />);
    expect(screen.getByRole("heading", { name: "FileWorks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Goods and services" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Products we sell" })).toBeInTheDocument();
    expect(screen.getAllByText("$5 / month").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$29 / month").length).toBeGreaterThan(0);
    expect(screen.getAllByText("API Expert").length).toBeGreaterThan(0);
    expect(screen.getAllByText("support@fileworks.ai").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "API" })[0]).toHaveAttribute("href", "/docs");
  });
});

describe("ApiPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("documents convert with curl, Python, and JavaScript", async () => {
    vi.spyOn(api, "fetchHealth").mockResolvedValue({
      status: "ok",
      app: "FileWorks",
      ocr_ready: true,
      ocr_engine: "ocr",
      ocr_error: null,
    });
    vi.spyOn(api, "fetchMe").mockResolvedValue(guestMe);
    render(<ApiPage />);
    expect(screen.getByRole("heading", { name: "Source + Intent" })).toBeInTheDocument();
    expect(screen.getByText(/Same sentence as the workspace/i)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "API" })[0]).toHaveAttribute("href", "/docs");
    expect(await screen.findByText("Reachable")).toBeInTheDocument();
    const samples = document.querySelectorAll(".api-code");
    const sampleText = Array.from(samples).map((node) => node.textContent || "").join("\n");
    expect(sampleText).toContain('curl -s -H "Authorization: Bearer YOUR_API_KEY"');
    expect(sampleText).toContain("-F download=true");
    expect(sampleText).toContain("jq -r .markdown");
    expect(sampleText).toContain("import requests");
    expect(sampleText).toContain("const body = new FormData");
    expect(sampleText).toContain("-F design=invoice");
    expect(sampleText).toContain("design_fill");
    expect(sampleText).not.toContain("Updated via API");
    expect(sampleText).not.toContain("/api/templates");
    expect(screen.getByText("X-Api-Key")).toBeInTheDocument();
    expect(screen.getAllByText(/\/api\/v1\/convert/).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Convert" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Endpoints" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Design examples" })).not.toBeInTheDocument();
  });
});

describe("ProfilePage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(api, "listApiKeys").mockResolvedValue([]);
  });

  it("shows usage role and lets a basic account upgrade", async () => {
    const user = userEvent.setup();
    const basicMe: MeResponse = {
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
      permissions: {
        extract: true,
        "extract.full_result": true,
        "extract.ai": true,
        "extract.translate": true,
        "history.read": true,
        export: true,
      },
      quota: { ...guestMe.quota, used_day: 1, limit_day: 1, remaining_day: 0, used_ai_day: 1, limit_ai_day: 1, remaining_ai_day: 0 },
    };
    const proMe = {
      ...basicMe,
      user: { ...basicMe.user!, plan: "pro" },
      plan: "pro",
      permissions: { ...basicMe.permissions, "extract.ai": true, "extract.translate": true },
      quota: { ...guestMe.quota, used_month: 3, limit_month: 100, remaining_month: 97 },
    };
    vi.spyOn(api, "fetchMe").mockResolvedValueOnce(basicMe).mockResolvedValue(proMe);
    vi.spyOn(api, "upgradePlan").mockResolvedValue(proMe);
    render(<ProfilePage />);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    expect(screen.getAllByText(/1 \/ 1 today/).length).toBeGreaterThan(0);
    expect(screen.getByText("AI / translation today")).toBeInTheDocument();
    expect(screen.getByText("Convert files")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upgrade to Daily" }));
    expect(api.upgradePlan).toHaveBeenCalledWith("pro");
    expect(await screen.findByText("Current plan")).toBeInTheDocument();
  });

  it("lets a pro account switch down to basic", async () => {
    const user = userEvent.setup();
    const proMe: MeResponse = {
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
      permissions: { extract: true, "extract.ai": true, "extract.translate": true, export: true },
      quota: { ...guestMe.quota, used_month: 3, limit_month: 100, remaining_month: 97 },
    };
    const basicMe = {
      ...proMe,
      user: { ...proMe.user!, plan: "basic" },
      plan: "basic",
      permissions: { extract: true, "extract.full_result": true, "history.read": true, export: true },
      quota: { ...guestMe.quota, used_day: 0, limit_day: 1, remaining_day: 1 },
    };
    vi.spyOn(api, "fetchMe").mockResolvedValue(proMe);
    vi.spyOn(api, "upgradePlan").mockResolvedValue(basicMe);
    render(<ProfilePage />);
    expect(await screen.findByText("Ada")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch to Casual" }));
    expect(api.upgradePlan).toHaveBeenCalledWith("basic");
    expect(await screen.findByText("Current plan")).toBeInTheDocument();
  });

  it("sends guests to login", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, search: "" });
    vi.spyOn(api, "fetchMe").mockResolvedValue(guestMe);
    render(<ProfilePage />);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/login?next=/profile"));
  });

  it("shows monthly usage and reports upgrade errors", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: "https://example.com/a.png", plan: "pro" },
      plan: "pro",
      permissions: { extract: true, "extract.ai": true, "extract.translate": true, export: true },
      quota: { ...guestMe.quota, used_month: 20, limit_month: 100, remaining_month: 80, used_ai_month: 20, limit_ai_month: 50, remaining_ai_month: 30 },
    });
    vi.spyOn(api, "upgradePlan").mockRejectedValue(new Error("plan_invalid"));
    render(<ProfilePage />);
    expect(await screen.findByText(/20 \/ 100 this month/)).toBeInTheDocument();
    expect(screen.getByText(/AI \/ translation pages this month/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upgrade to Expert" }));
    expect(await screen.findByText("plan_invalid")).toBeInTheDocument();
  });

  it("sends paid upgrades through Stripe checkout", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, search: "" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
      permissions: { extract: true, "extract.ai": true, export: true },
      billing: { enabled: true, prices: { basic: false, pro: true, premium: true } },
    });
    vi.spyOn(api, "startCheckout").mockResolvedValue({ url: "https://checkout.stripe.test/cs", updated: false, plan: "pro" });
    render(<ProfilePage />);
    expect(await screen.findByText(/Downgrade when this period's usage fits/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upgrade to Daily" }));
    expect(api.startCheckout).toHaveBeenCalledWith("pro");
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs");
    expect(screen.getByRole("button", { name: "Manage billing" })).toBeInTheDocument();
  });

  it("syncs Stripe after returning from the billing portal", async () => {
    vi.stubGlobal("location", { assign: vi.fn(), search: "?billing=return" });
    vi.spyOn(api, "syncBilling").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
      permissions: { extract: true, "extract.ai": true, export: true },
      billing: {
        enabled: true,
        prices: { basic: false, pro: true, premium: true },
        cancel_at_period_end: true,
        current_period_end: "2030-01-01T00:00:00+00:00",
      },
    });
    render(<ProfilePage />);
    expect(await screen.findByText(/This role stays until/)).toBeInTheDocument();
    expect(api.syncBilling).toHaveBeenCalled();
  });

  it("blocks a downgrade when usage exceeds the lower plan", async () => {
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "premium" },
      plan: "premium",
      permissions: { extract: true, "extract.ai": true, export: true },
      quota: { ...guestMe.quota, used_day: 50, used_ai_month: 600, limit_day: 200, remaining_day: 150 },
      billing: { enabled: true, prices: { basic: false, pro: true, premium: true }, amounts: { basic: 0, pro: 5, premium: 29 } },
    });
    render(<ProfilePage />);
    expect(await screen.findByRole("button", { name: "Switch to Daily" })).toBeDisabled();
    expect(screen.getByText(/Usage is over this plan/)).toBeInTheDocument();
  });

  it("lets a paid account switch to another paid plan", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, search: "" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "premium" },
      plan: "premium",
      permissions: { extract: true, "extract.ai": true, export: true },
      billing: { enabled: true, prices: { basic: false, pro: true, premium: true } },
    });
    vi.spyOn(api, "startCheckout").mockResolvedValue({
      url: "https://checkout.stripe.test/cs_switch",
      updated: false,
      plan: "pro",
    });
    render(<ProfilePage />);
    await user.click(await screen.findByRole("button", { name: "Switch to Daily" }));
    expect(api.startCheckout).toHaveBeenCalledWith("pro");
    expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs_switch");
  });

  it("creates and shows a one-time API key secret", async () => {
    const user = userEvent.setup();
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
      api_plan: "api_free",
      api_quota: { used_credits: 0, limit_credits: 25, remaining_credits: 25 },
    });
    vi.spyOn(api, "createApiKey").mockResolvedValue({
      id: "k1",
      name: "CI",
      prefix: "fw_live_abcd",
      last4: "Wxyz",
      created_at: "2026-08-15T00:00:00Z",
      last_used_at: null,
      token: "fw_live_abcdsecretWxyz",
    });
    vi.spyOn(api, "listApiKeys")
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        {
          id: "k1",
          name: "CI",
          prefix: "fw_live_abcd",
          last4: "Wxyz",
          created_at: "2026-08-15T00:00:00Z",
          last_used_at: null,
        },
      ]);
    render(<ProfilePage />);
    expect(await screen.findByRole("heading", { name: "API keys" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "API plan" })).toBeInTheDocument();
    expect(screen.getByText("API AI pages this month")).toBeInTheDocument();
    expect(screen.getAllByText(/0 \/ 25 this month/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Convert API: 25 AI pages \/ month/)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Key name (optional)"), "CI");
    await user.click(screen.getByRole("button", { name: "Generate key" }));
    expect(api.createApiKey).toHaveBeenCalledWith("CI");
    expect(await screen.findByText("fw_live_abcdsecretWxyz")).toBeInTheDocument();
    expect(screen.getByText(/Copy this key now/)).toBeInTheDocument();
  });

  it("confirms checkout on profile then syncs", async () => {
    vi.stubGlobal("location", { assign: vi.fn(), search: "?checkout=success&session_id=cs_1" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
      billing: { enabled: true, prices: { basic: false, pro: true, premium: true } },
    });
    vi.spyOn(api, "confirmCheckout").mockResolvedValue({ plan: "pro" });
    vi.spyOn(api, "syncBilling").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
      permissions: { extract: true, "extract.ai": true, export: true },
      billing: { enabled: true, prices: { basic: false, pro: true, premium: true } },
    });
    render(<ProfilePage />);
    expect(await screen.findByText("Payment received. Your role is updated.")).toBeInTheDocument();
    expect(api.confirmCheckout).toHaveBeenCalledWith("cs_1");
    expect(api.syncBilling).toHaveBeenCalled();
  });

  it("syncs profile when checkout confirm fails", async () => {
    vi.stubGlobal("location", { assign: vi.fn(), search: "?checkout=success&session_id=cs_1" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
      billing: { enabled: true, prices: { basic: false, pro: true, premium: true } },
    });
    vi.spyOn(api, "confirmCheckout").mockRejectedValue(new Error("confirm failed"));
    vi.spyOn(api, "syncBilling").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
      permissions: { extract: true, "extract.ai": true, export: true },
      billing: { enabled: true, prices: { basic: false, pro: true, premium: true } },
    });
    render(<ProfilePage />);
    expect(await screen.findByText("Payment received. Your role is updated.")).toBeInTheDocument();
    expect(api.syncBilling).toHaveBeenCalled();
  });

  it("opens the billing portal and reports a missing checkout URL", async () => {
    const user = userEvent.setup();
    const assign = vi.fn();
    vi.stubGlobal("location", { assign, search: "?checkout=cancel" });
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "basic" },
      plan: "basic",
      permissions: { extract: true, "extract.ai": true, export: true },
      billing: { enabled: true, prices: { basic: false, pro: true, premium: true } },
    });
    vi.spyOn(api, "startCheckout").mockResolvedValue({ url: null, updated: false, plan: "pro" });
    vi.spyOn(api, "openBillingPortal").mockResolvedValue({ url: "https://billing.stripe.test/p" });
    render(<ProfilePage />);
    expect(await screen.findByText(/Checkout canceled — no charge/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Upgrade to Daily" }));
    expect(await screen.findByText("Stripe did not return a billing URL")).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Manage billing" }));
    expect(assign).toHaveBeenCalledWith("https://billing.stripe.test/p");
  });

  it("shows a pending Stripe cancellation on the current plan", async () => {
    vi.spyOn(api, "fetchMe").mockResolvedValue({
      ...guestMe,
      user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
      plan: "pro",
      permissions: { extract: true, "extract.ai": true, export: true },
      billing: {
        enabled: true,
        prices: { basic: false, pro: true, premium: true },
        cancel_at_period_end: true,
        current_period_end: "2030-01-01T00:00:00+00:00",
        subscription_status: "active",
      },
    });
    render(<ProfilePage />);
    expect(await screen.findByText(/You keep this role until then/)).toBeInTheDocument();
    expect(screen.getByText(/Current · cancels/)).toBeInTheDocument();
  });
});

describe("ResultPanel", () => {
  it("hides conversion engine names from the client", () => {
    render(
      <ResultPanel
        result={{
          filename: "doc.pdf",
          content_type: "application/pdf",
          size_bytes: 1,
          engine: "AnyDoc",
          page_count: 3,
          format: "both",
          markdown: "# Hello",
          json: {},
          pages: [],
        }}
        loading={false}
        error={null}
        view="markdown"
        onViewChange={vi.fn()}
        markdownDraft="# Hello"
        markdownMode="preview"
      />,
    );
    expect(screen.getByText("3 pages")).toBeInTheDocument();
    expect(screen.queryByText(/AnyDoc/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PP-OCR/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Paddle/i)).not.toBeInTheDocument();
  });

  it("switches tabs and copies", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const onViewChange = vi.fn();
    const onMarkdownChange = vi.fn();
    const { rerender } = render(
      <ResultPanel
        result={{
          filename: "note.png",
          content_type: "image/png",
          size_bytes: 1,
          engine: "ocr",
          page_count: 1,
          format: "both",
          markdown: "# Hello",
          json: { a: 1 },
          pages: [],
          regions: [{ id: "r1", page: 1, label: "text", text: "Hello", bbox: [0, 0, 1, 1] }],
        }}
        loading={false}
        error={null}
        view="markdown"
        onViewChange={onViewChange}
        markdownDraft="# Hello"
        onMarkdownChange={onMarkdownChange}
        markdownMode="edit"
        onMarkdownModeChange={vi.fn()}
        toolbarVisible={false}
        onToolbarVisibleChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("tab", { name: "JSON" }));
    expect(onViewChange).toHaveBeenCalledWith("json");
    await user.click(screen.getByRole("tab", { name: "Source" }));
    const tablist = screen.getByRole("tablist", { name: "Result view" });
    expect(within(tablist).getByRole("tab", { name: "Preview" })).toBeInTheDocument();
    // Icon-only tabs — labels live in aria-label/title, not visible text.
    expect(within(tablist).queryByText("Preview")).not.toBeInTheDocument();
    expect(within(tablist).queryByText("Source")).not.toBeInTheDocument();
    expect(within(tablist).queryByText("JSON")).not.toBeInTheDocument();
    Object.defineProperty(window, "open", {
      configurable: true,
      value: vi.fn(() => ({
        document: { write: vi.fn(), close: vi.fn() },
        focus: vi.fn(),
        print: vi.fn(),
      })),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>ok</html>", { status: 200 })));
    await user.click(screen.getByLabelText("Download"));
    expect(screen.queryByText("PNG (.png)")).not.toBeInTheDocument();
    expect(screen.queryByText("JPEG (.jpg)")).not.toBeInTheDocument();
    expect(screen.getByText("Word (.docx)")).toBeInTheDocument();
    await user.click(screen.getByText("PDF"));
    await user.click(screen.getByText(/recognized region/));
    expect(screen.getAllByText("Hello").length).toBeGreaterThan(0);
    rerender(
      <ResultPanel
        result={{
          filename: "note.png",
          content_type: "image/png",
          size_bytes: 1,
          engine: "ocr",
          page_count: 1,
          format: "both",
          markdown: "# Hello",
          json: { a: 1 },
          pages: [],
        }}
        loading={false}
        error={null}
        view="markdown"
        onViewChange={vi.fn()}
        markdownDraft="# Hello"
        onMarkdownChange={vi.fn()}
        markdownMode="preview"
        toolbarVisible
      />,
    );
  });

  it("shows empty and error states", () => {
    const { rerender } = render(
      <ResultPanel result={null} loading={false} error={null} view="markdown" onViewChange={vi.fn()} />,
    );
    expect(screen.getByText(/You’ll get Markdown/i)).toBeInTheDocument();
    expect(screen.getByText(/Choose what to produce, drop a source file/i)).toBeInTheDocument();
    rerender(
      <ResultPanel
        result={null}
        loading={false}
        error={null}
        view="markdown"
        onViewChange={vi.fn()}
        intentName="Client invoice"
        onChooseIntent={vi.fn()}
      />,
    );
    expect(screen.getByText(/You’ll get Client invoice/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Change what to produce/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Produce as: Client invoice/i })).toHaveTextContent(
      "Client invoice",
    );
    rerender(<ResultPanel result={null} loading={false} error="boom" view="markdown" onViewChange={vi.fn()} />);
    expect(screen.getByText("boom")).toBeInTheDocument();
    rerender(<ResultPanel result={null} loading error={null} view="markdown" onViewChange={vi.fn()} />);
    expect(screen.getByText(/Converting your file/)).toBeInTheDocument();
  });

  it("shows a progress indicator only while a run is active", () => {
    const { rerender } = render(
      <ResultPanel result={null} loading={false} error={null} view="markdown" onViewChange={vi.fn()} />,
    );
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    rerender(<ResultPanel result={null} loading error={null} view="markdown" onViewChange={vi.fn()} />);
    expect(screen.getByRole("progressbar")).toHaveAccessibleName("Converting your file…");
    expect(screen.getByText("Use Stop to cancel")).toBeInTheDocument();
  });

  it("labels the indicator for the running operation", () => {
    render(
      <ResultPanel
        result={null}
        loading
        busyLabel="Opening your document…"
        busyHint={null}
        error={null}
        view="markdown"
        onViewChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("progressbar")).toHaveAccessibleName("Opening your document…");
    expect(screen.queryByText(/Use Stop to cancel/)).not.toBeInTheDocument();
  });

  it("counts elapsed time up while converting and resets after", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <ResultPanel result={null} loading error={null} view="markdown" onViewChange={vi.fn()} />,
      );
      expect(screen.getByText("Use Stop to cancel")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(screen.getByText("3s elapsed · Use Stop to cancel")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(60000);
      });
      expect(screen.getByText("1m 03s elapsed · Use Stop to cancel")).toBeInTheDocument();
      rerender(
        <ResultPanel result={null} loading={false} error={null} view="markdown" onViewChange={vi.fn()} />,
      );
      rerender(<ResultPanel result={null} loading error={null} view="markdown" onViewChange={vi.fn()} />);
      expect(screen.getByText("Use Stop to cancel")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows five line-pages then swaps to the next set", async () => {
    const user = userEvent.setup();
    const lines = Array.from({ length: LINES_PER_PAGE * PAGES_PER_VIEW + LINES_PER_PAGE + 3 }, (_, index) => `Line ${index + 1}`);
    const markdown = lines.join("\n");
    render(
      <ResultPanel
        result={{
          filename: "doc.pdf",
          content_type: "application/pdf",
          size_bytes: 1,
          engine: "ocr",
          page_count: 1,
          format: "both",
          markdown,
          json: { pages: [] },
          pages: [],
        }}
        loading={false}
        error={null}
        view="markdown"
        onViewChange={vi.fn()}
        markdownDraft={markdown}
        onMarkdownChange={vi.fn()}
        markdownMode="edit"
      />,
    );
    const first = screen.getByPlaceholderText("Edit Markdown source…") as HTMLTextAreaElement;
    expect(first.value).toContain("Line 1");
    expect(first.value).toContain(`Line ${LINES_PER_PAGE * PAGES_PER_VIEW}`);
    expect(first.value).not.toContain(`Line ${LINES_PER_PAGE * PAGES_PER_VIEW + 1}`);
    expect(screen.getByText("Pages 1–5 of 7")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next" }));
    const next = screen.getByPlaceholderText("Edit Markdown source…") as HTMLTextAreaElement;
    expect(next.value).toContain(`Line ${LINES_PER_PAGE * PAGES_PER_VIEW + 1}`);
    expect(next.value).not.toContain("Line 1");
    expect(screen.getByText("Pages 6–7 of 7")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(screen.getByText("Pages 1–5 of 7")).toBeInTheDocument();
    expect((screen.getByPlaceholderText("Edit Markdown source…") as HTMLTextAreaElement).value).toContain("Line 1");
    const goTo = screen.getByLabelText("Go to page") as HTMLInputElement;
    await user.clear(goTo);
    await user.type(goTo, "7{Enter}");
    expect(screen.getByText("Pages 6–7 of 7")).toBeInTheDocument();
  });

  it("previews filled design HTML in an iframe so styles do not leak to the app shell", () => {
    const designHtml =
      '<!doctype html><html><head><style>html,body{background:#e8ece9}</style></head><body><section class="page">Invoice</section></body></html>';
    render(
      <ResultPanel
        result={{
          filename: "note.png",
          content_type: "image/png",
          size_bytes: 1,
          engine: "ocr",
          page_count: 1,
          format: "both",
          markdown: "# Hello",
          json: {},
          pages: [],
        }}
        loading={false}
        error={null}
        view="markdown"
        onViewChange={vi.fn()}
        markdownDraft="# Hello"
        renderedHtml={designHtml}
        templateId="invoice"
        templateName="Client invoice"
      />,
    );
    const frame = screen.getByTitle("Client invoice design") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("srcdoc")).toContain("background:#e8ece9");
    expect(document.body.querySelector("style")?.textContent ?? "").not.toContain("background:#e8ece9");
  });
});

describe("EditableMarkdownPreview", () => {
  it("renders markdown html and applies commands", async () => {
    const onChange = vi.fn();
    const ref = createRef<MarkdownPreviewHandle>();
    document.execCommand = vi.fn(() => true) as typeof document.execCommand;
    render(<EditableMarkdownPreview markdown="# Title" onChange={onChange} ref={ref} />);
    await waitFor(() => {
      expect(document.querySelector('[aria-label="Editable Markdown preview"]')).toBeInTheDocument();
    });
    const editor = document.querySelector('[aria-label="Editable Markdown preview"]') as HTMLElement;
    editor.innerHTML = '<p>hello</p><img src="data:image/png;base64,aa" width="100" class="fw-img-left" />';
    ref.current?.focus();
    for (const command of [
      "bold",
      "italic",
      "strike",
      "code",
      "h1",
      "h2",
      "h3",
      "quote",
      "ul",
      "ol",
      "hr",
      "img-larger",
      "img-smaller",
      "img-left",
      "img-right",
      "img-inline",
    ] as const) {
      ref.current?.applyCommand(command);
    }
    ref.current?.applyCommand("link", { url: "https://example.com" });
    ref.current?.applyCommand("image", { dataUrl: "data:image/png;base64,bb", alt: "logo" });
    fireEvent.blur(editor);
    fireEvent.keyDown(editor, { key: "Escape" });
    fireEvent.mouseDown(editor.querySelector("img")!);
  });

  it("renders LaTeX formulas with KaTeX in the preview", async () => {
    render(<EditableMarkdownPreview markdown={"Energy $E=mc^2$\n\n$$\\frac{a}{b}$$"} />);
    await waitFor(() => {
      const editor = document.querySelector('[aria-label="Editable Markdown preview"]') as HTMLElement;
      expect(editor.querySelector(".katex")).toBeTruthy();
      expect(editor.querySelector(".math-inline")?.getAttribute("data-latex")).toBe("E=mc^2");
      expect(editor.querySelector(".math-display")?.getAttribute("data-latex")).toBe("\\frac{a}{b}");
      expect(editor.querySelector(".math-inline")?.getAttribute("contenteditable")).toBe("false");
    });
  });

  it("commits preview math back to markdown on blur", async () => {
    const onChange = vi.fn();
    render(<EditableMarkdownPreview markdown="placeholder" onChange={onChange} />);
    const editor = await waitFor(() => {
      const node = document.querySelector('[aria-label="Editable Markdown preview"]') as HTMLElement;
      expect(node.textContent).toContain("placeholder");
      return node;
    });
    fireEvent.focus(editor);
    editor.innerHTML =
      '<p>See <span class="math-inline" data-latex="E=mc^2"><span class="katex">x</span></span></p>';
    fireEvent.blur(editor);
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      const value = onChange.mock.calls.at(-1)?.[0] as string;
      expect(value).toContain("$E=mc^2$");
    });
  });
});
