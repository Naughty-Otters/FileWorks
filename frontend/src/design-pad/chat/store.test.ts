import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "./store";

describe("design chat store", () => {
  beforeEach(() => {
    useChatStore.setState({ open: true, messages: [], loading: false });
  });

  it("toggles open state", () => {
    useChatStore.getState().setOpen(false);
    expect(useChatStore.getState().open).toBe(false);
    useChatStore.getState().toggleOpen();
    expect(useChatStore.getState().open).toBe(true);
  });

  it("records user assistant and error messages", () => {
    useChatStore.getState().addUserMessage("Center the title");
    useChatStore.getState().addAssistantMessage("Done.");
    useChatStore.getState().addErrorMessage("offline");
    const types = useChatStore.getState().messages.map((m) => m.type);
    expect(types).toEqual(["user", "assistant", "error"]);
  });

  it("tracks step status updates by message id", () => {
    const id = useChatStore.getState().addStepsMessage([
      {
        reasoning: "Title was left-aligned.",
        summary: "Center title",
        ops: [{ op: "update_style", id: "title", patch: { align: "center" } }],
        status: "pending",
      },
    ]);
    useChatStore.getState().updateStepStatus(id, 0, { status: "done" });
    const msg = useChatStore.getState().messages.find((m) => m.id === id);
    expect(msg?.type).toBe("steps");
    if (msg?.type === "steps") {
      expect(msg.steps[0]?.status).toBe("done");
      expect(msg.steps[0]?.reasoning).toContain("left-aligned");
    }
  });

  it("clears the thread", () => {
    useChatStore.getState().addUserMessage("hi");
    useChatStore.getState().clearMessages();
    expect(useChatStore.getState().messages).toEqual([]);
  });
});
