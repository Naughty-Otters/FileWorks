import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeLanding } from "@/components/home-landing";
import { PRODUCT } from "@/lib/product-copy";

describe("HomeLanding", () => {
  it("drops a file and offers Editor and Designs", () => {
    const onFileSelect = vi.fn();
    render(<HomeLanding onFileSelect={onFileSelect} />);
    expect(screen.getByText(PRODUCT.homeLine)).toBeInTheDocument();
    expect(screen.getByText(PRODUCT.homeSupport)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: `Open ${PRODUCT.editor}` })).toHaveAttribute("href", "/edit");
    expect(screen.getByRole("link", { name: `Browse ${PRODUCT.designs}` })).toHaveAttribute(
      "href",
      "/templates",
    );
    fireEvent.drop(document.querySelector(".home-landing")!, {
      dataTransfer: { files: [new File(["x"], "letter.pdf", { type: "application/pdf" })] },
    });
    expect(onFileSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "letter.pdf" }));
  });

  it("opens the file picker from the CTA", async () => {
    const user = userEvent.setup();
    const onFileSelect = vi.fn();
    render(<HomeLanding onFileSelect={onFileSelect} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "scan.png", { type: "image/png" });
    await user.upload(input, file);
    expect(onFileSelect).toHaveBeenCalledWith(expect.objectContaining({ name: "scan.png" }));
  });

  it("shows History when offered", async () => {
    const user = userEvent.setup();
    const onOpenHistory = vi.fn();
    render(<HomeLanding onFileSelect={vi.fn()} onOpenHistory={onOpenHistory} />);
    await user.click(screen.getByRole("button", { name: "History" }));
    expect(onOpenHistory).toHaveBeenCalled();
  });

  it("names an Intent on the drop CTA", () => {
    render(<HomeLanding onFileSelect={vi.fn()} intentName="Client invoice" />);
    expect(screen.getByText(/Drop a file to fill Client invoice/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload document" })).toHaveTextContent(
      /Choose file for Client invoice/i,
    );
  });

  it("ignores drops while disabled", () => {
    const onFileSelect = vi.fn();
    render(<HomeLanding disabled onFileSelect={onFileSelect} />);
    fireEvent.drop(document.querySelector(".home-landing")!, {
      dataTransfer: { files: [new File(["x"], "letter.pdf", { type: "application/pdf" })] },
    });
    expect(onFileSelect).not.toHaveBeenCalled();
  });
});
