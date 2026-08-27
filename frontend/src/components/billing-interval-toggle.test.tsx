import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BillingIntervalToggle } from "@/components/billing-interval-toggle";

describe("BillingIntervalToggle", () => {
  it("labels the control and exposes monthly/yearly as radios", () => {
    const onChange = vi.fn();
    render(<BillingIntervalToggle value="month" onChange={onChange} />);

    expect(screen.getByText("How you pay")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "How you pay" })).toBeInTheDocument();

    const monthly = screen.getByRole("radio", { name: /Monthly/i });
    const yearly = screen.getByRole("radio", { name: /Yearly/i });
    expect(monthly).toHaveAttribute("aria-checked", "true");
    expect(yearly).toHaveAttribute("aria-checked", "false");
    expect(yearly).toHaveTextContent(/Save 30%/i);
    expect(yearly).toHaveTextContent(/one bill a year/i);
    expect(monthly).toHaveTextContent(/Billed every month/i);
  });

  it("notifies when the selected interval changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<BillingIntervalToggle value="month" onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: /Yearly/i }));
    expect(onChange).toHaveBeenCalledWith("year");

    rerender(<BillingIntervalToggle value="year" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: /Yearly/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Monthly/i })).toHaveAttribute("aria-checked", "false");

    await user.click(screen.getByRole("radio", { name: /Monthly/i }));
    expect(onChange).toHaveBeenCalledWith("month");
  });
});
