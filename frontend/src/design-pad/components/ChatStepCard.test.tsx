import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ChatStepCard from "./ChatStepCard";
import type { DesignEditStepWithStatus } from "../chat/store";

describe("ChatStepCard", () => {
  const base: DesignEditStepWithStatus = {
    reasoning: "Title is left-aligned at 24px; centering improves hierarchy.",
    summary: "Center title",
    ops: [{ op: "update_style", id: "title", patch: { align: "center" } }],
    status: "pending",
  };

  it("shows summary status ops count and reasoning", () => {
    render(<ChatStepCard step={base} index={0} />);
    expect(screen.getByText("Center title")).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText(/1 operation/)).toBeInTheDocument();
    expect(screen.getByText(/centering improves hierarchy/i)).toBeInTheDocument();
  });

  it("collapses reasoning after toggle", async () => {
    const user = userEvent.setup();
    render(<ChatStepCard step={{ ...base, status: "done" }} index={1} />);
    expect(screen.getByText("Done")).toBeInTheDocument();
    // done steps start with reasoning collapsed
    expect(screen.queryByText(/centering improves hierarchy/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reasoning" }));
    expect(screen.getByText(/centering improves hierarchy/i)).toBeInTheDocument();
  });

  it("surfaces step errors", () => {
    render(
      <ChatStepCard
        step={{ ...base, status: "failed", error: "Unknown node id: title" }}
        index={0}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Unknown node id: title")).toBeInTheDocument();
  });
});
