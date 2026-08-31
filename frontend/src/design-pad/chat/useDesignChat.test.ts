import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDesignChat } from "./useDesignChat";
import { useChatStore } from "./store";
import { useEditorStore } from "../store";
import { createEmptyDocument } from "../types";
import * as api from "@/lib/api";
import { resetSessionStore, setSessionMe } from "@/lib/session";
import type { MeResponse } from "@/lib/auth";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
}));

const signedInMe: MeResponse = {
  user: { id: "1", email: "a@b.co", name: "Ada", picture_url: null, plan: "pro" },
  plan: "pro",
  permissions: { extract: true, "extract.ai": true },
  quota: {
    used_day: 0,
    used_month: 0,
    limit_day: null,
    limit_month: 100,
    remaining_day: null,
    remaining_month: 100,
    used_ai_day: 0,
    used_ai_month: 0,
    limit_ai_day: null,
    limit_ai_month: 50,
    remaining_ai_day: null,
    remaining_ai_month: 50,
  },
  google_client_id: null,
};

describe("useDesignChat", () => {
  beforeEach(() => {
    push.mockReset();
    resetSessionStore();
    useChatStore.setState({ open: true, messages: [], loading: false });
    useEditorStore.setState({
      doc: createEmptyDocument(),
      selectedId: null,
      history: { past: [], future: [] },
    });
    vi.restoreAllMocks();
  });

  it("sends guests to login", async () => {
    setSessionMe({
      user: null,
      plan: "anonymous",
      permissions: {},
      quota: signedInMe.quota!,
      google_client_id: null,
    });
    const { result } = renderHook(() => useDesignChat());
    await act(async () => {
      await result.current.send("Center the title");
    });
    expect(push).toHaveBeenCalled();
    expect(String(push.mock.calls[0]?.[0])).toContain("/login?next=");
    expect(useChatStore.getState().messages).toHaveLength(0);
  });

  it("applies returned ops and records step statuses", async () => {
    setSessionMe(signedInMe);
    vi.spyOn(api, "editDesign").mockResolvedValue({
      reply: "Centered the title.",
      steps: [
        {
          reasoning: "Title was left-aligned.",
          summary: "Center title",
          ops: [{ op: "add_element", kind: "heading", parentId: "root", x: 10, y: 10 }],
        },
      ],
    });

    const { result } = renderHook(() => useDesignChat());
    await act(async () => {
      await result.current.send("Add a heading");
    });

    await waitFor(() => expect(useChatStore.getState().loading).toBe(false));
    const messages = useChatStore.getState().messages;
    expect(messages.some((m) => m.type === "user")).toBe(true);
    expect(messages.some((m) => m.type === "assistant")).toBe(true);
    const steps = messages.find((m) => m.type === "steps");
    expect(steps?.type).toBe("steps");
    if (steps?.type === "steps") {
      expect(steps.steps[0]?.status).toBe("done");
    }
    expect(useEditorStore.getState().doc.root.children.some((c) => c.kind === "heading")).toBe(true);
    expect(api.editDesign).toHaveBeenCalled();
  });

  it("surfaces API errors in the chat thread", async () => {
    setSessionMe(signedInMe);
    vi.spyOn(api, "editDesign").mockRejectedValue(new Error("quota exceeded"));
    const { result } = renderHook(() => useDesignChat());
    await act(async () => {
      await result.current.send("Make it bigger");
    });
    await waitFor(() => expect(useChatStore.getState().loading).toBe(false));
    const err = useChatStore.getState().messages.find((m) => m.type === "error");
    expect(err?.type === "error" && err.content).toBe("quota exceeded");
  });

  it("marks empty-op steps done and failed ops as failed", async () => {
    setSessionMe(signedInMe);
    vi.spyOn(api, "editDesign").mockResolvedValue({
      reply: "Tried.",
      steps: [
        {
          reasoning: "No mutation needed.",
          summary: "Acknowledge",
          ops: [],
        },
        {
          reasoning: "Target is missing.",
          summary: "Update missing node",
          ops: [{ op: "update_label", id: "missing", label: "X" }],
        },
      ],
    });
    const { result } = renderHook(() => useDesignChat());
    await act(async () => {
      await result.current.send("Rename missing");
    });
    await waitFor(() => expect(useChatStore.getState().loading).toBe(false));
    const steps = useChatStore.getState().messages.find((m) => m.type === "steps");
    expect(steps?.type).toBe("steps");
    if (steps?.type === "steps") {
      expect(steps.steps[0]?.status).toBe("done");
      expect(steps.steps[1]?.status).toBe("failed");
      expect(steps.steps[1]?.error).toMatch(/Unknown/);
    }
  });

  it("ignores blank messages while loading", async () => {
    setSessionMe(signedInMe);
    useChatStore.setState({ loading: true });
    const edit = vi.spyOn(api, "editDesign");
    const { result } = renderHook(() => useDesignChat());
    await act(async () => {
      await result.current.send("   ");
      await result.current.send("while busy");
    });
    expect(edit).not.toHaveBeenCalled();
  });
});
