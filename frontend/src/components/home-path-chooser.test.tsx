import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomePathChooser } from "@/components/home-path-chooser";
import { PRODUCT } from "@/lib/product-copy";

describe("HomePathChooser", () => {
  it("offers Edit and Produce for a PDF", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const onProduce = vi.fn();
    const onReplace = vi.fn();
    render(
      <HomePathChooser
        file={new File(["pdf"], "letter.pdf", { type: "application/pdf" })}
        previewUrl="blob:mock"
        onEdit={onEdit}
        onProduce={onProduce}
        onReplace={onReplace}
      />,
    );
    expect(screen.getByText(PRODUCT.whatNext)).toBeInTheDocument();
    expect(screen.getByText(PRODUCT.homeSupport)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Edit text on the page/i }));
    expect(onEdit).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /Produce a Design/i }));
    expect(onProduce).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(onReplace).toHaveBeenCalled();
  });

  it("offers Edit for images", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(
      <HomePathChooser
        file={new File(["img"], "scan.png", { type: "image/png" })}
        previewUrl="blob:mock"
        onEdit={onEdit}
        onProduce={vi.fn()}
        onReplace={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Edit text on the page/i }));
    expect(onEdit).toHaveBeenCalled();
  });

  it("previews markdown and replaces the file", async () => {
    const user = userEvent.setup();
    const onReplace = vi.fn();
    render(
      <HomePathChooser
        file={new File(["# Hello"], "note.md", { type: "text/markdown" })}
        previewUrl={null}
        onEdit={vi.fn()}
        onProduce={vi.fn()}
        onReplace={onReplace}
      />,
    );
    expect(await screen.findByText("# Hello")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit text on the page/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace" }));
    expect(onReplace).toHaveBeenCalled();
  });

  it("hides Edit for office files", () => {
    render(
      <HomePathChooser
        file={new File(["doc"], "letter.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        })}
        previewUrl={null}
        onEdit={vi.fn()}
        onProduce={vi.fn()}
        onReplace={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Edit text on the page/i })).not.toBeInTheDocument();
    expect(screen.getByText(PRODUCT.editorPdfImagesOnly)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Produce a Design/i })).toBeInTheDocument();
  });

  it("respects disabled state", () => {
    render(
      <HomePathChooser
        file={new File(["pdf"], "letter.pdf", { type: "application/pdf" })}
        previewUrl="blob:mock"
        disabled
        onEdit={vi.fn()}
        onProduce={vi.fn()}
        onReplace={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Edit text on the page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Produce a Design/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled();
  });
});
