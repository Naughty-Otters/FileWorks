import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DocsLiteEditor } from "@/components/docs-lite-editor";

describe("DocsLiteEditor", () => {
  it("renders Markdown as a document with a formatting toolbar", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DocsLiteEditor markdown="# Hello\n\nWorld" onChange={onChange} />);

    const doc = await screen.findByLabelText("Document");
    expect(doc).toBeInTheDocument();
    await waitFor(() => expect(doc.textContent).toMatch(/Hello/));
    await waitFor(() => expect(doc.textContent).toMatch(/World/));

    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Heading 1" })).toBeInTheDocument();

    // Toggle heading — TipTap updates without relying on jsdom selection coords.
    await user.click(screen.getByRole("button", { name: "Heading 2" }));
    await waitFor(() => expect(onChange.mock.calls.length).toBeGreaterThan(0));
    const last = String(onChange.mock.calls.at(-1)?.[0] ?? "");
    expect(last.length).toBeGreaterThan(0);
  });

  it("loads file content that matches the initial markdown prop", async () => {
    const body = "# Loaded from file\n\nParagraph one.";
    render(<DocsLiteEditor markdown={body} onChange={vi.fn()} />);
    const doc = await screen.findByLabelText("Document");
    await waitFor(() => expect(doc.textContent).toMatch(/Loaded from file/));
    await waitFor(() => expect(doc.textContent).toMatch(/Paragraph one/));
  });

  it("does not wipe parent markdown via onChange before seed", async () => {
    const body = "# Keep me\n\nStill here.";
    let markdown = body;
    const onChange = vi.fn((next: string) => {
      markdown = next;
    });
    const { rerender } = render(
      <DocsLiteEditor markdown={markdown} onChange={onChange} />,
    );

    const doc = await screen.findByLabelText("Document");
    await waitFor(() => expect(doc.textContent).toMatch(/Keep me/));
    await waitFor(() => expect(doc.textContent).toMatch(/Still here/));

    // Re-render with whatever onChange produced — must not have cleared the file.
    rerender(<DocsLiteEditor markdown={markdown} onChange={onChange} />);
    await waitFor(() => expect(doc.textContent).toMatch(/Keep me/));
    expect(markdown.trim().length).toBeGreaterThan(0);
    expect(markdown).toMatch(/Keep me|Still here/);
  });

  it("can hide the toolbar", async () => {
    render(<DocsLiteEditor markdown="Hi" hideToolbar />);
    await screen.findByLabelText("Document");
    expect(screen.queryByRole("button", { name: "Bold" })).not.toBeInTheDocument();
  });
});
