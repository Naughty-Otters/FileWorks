import { beforeEach, describe, expect, it } from "vitest";
import { formatOpLabel, useChatStore } from "./store";

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

  it("tracks an agent turn from planning through step updates", () => {
    const id = useChatStore.getState().startTurn("Center the title");
    const planning = useChatStore.getState().messages.find((m) => m.id === id);
    expect(planning?.type).toBe("turn");
    if (planning?.type === "turn") {
      expect(planning.status).toBe("planning");
      expect(planning.user).toBe("Center the title");
    }

    useChatStore.getState().completeTurn(id, {
      reply: "Done.",
      designBrief: {
        intent: "create",
        concept: "Clean invoice.",
        bands: ["Header", "Meta"],
        notes: "",
      },
      steps: [
        {
          reasoning: "Title was left-aligned.",
          summary: "Center title",
          ops: [{ op: "update_style", id: "title", patch: { align: "center" } }],
          status: "pending",
        },
      ],
    });
    useChatStore.getState().updateStepStatus(id, 0, { status: "done" });
    const done = useChatStore.getState().messages.find((m) => m.id === id);
    expect(done?.type).toBe("turn");
    if (done?.type === "turn") {
      expect(done.reply).toBe("Done.");
      expect(done.designBrief?.bands).toEqual(["Header", "Meta"]);
      expect(done.steps[0]?.status).toBe("done");
      expect(done.status).toBe("done");
    }
  });

  it("records standalone errors and clears the thread", () => {
    useChatStore.getState().startTurn("hi");
    useChatStore.getState().addErrorMessage("offline");
    expect(useChatStore.getState().messages.some((m) => m.type === "error")).toBe(true);
    useChatStore.getState().clearMessages();
    expect(useChatStore.getState().messages).toEqual([]);
  });

  it("formats op labels for the activity trail", () => {
    expect(formatOpLabel({ op: "add_element", kind: "box", parentId: "root" })).toContain("box");
    expect(formatOpLabel({ op: "add_variable", name: "invoice_date", label: "Date" })).toContain(
      "invoice_date",
    );
  });
});
