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

  it("applies returned ops and records turn statuses", async () => {
    setSessionMe(signedInMe);
    vi.spyOn(api, "editDesign").mockResolvedValue({
      reply: "Centered the title.",
      designBrief: {
        intent: "adjust",
        concept: "Center the title for balance.",
        bands: [],
        notes: "",
      },
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
    const turn = useChatStore.getState().messages.find((m) => m.type === "turn");
    expect(turn?.type).toBe("turn");
    if (turn?.type === "turn") {
      expect(turn.user).toBe("Add a heading");
      expect(turn.reply).toBe("Centered the title.");
      expect(turn.designBrief?.concept).toContain("Center the title");
      expect(turn.steps[0]?.status).toBe("done");
      expect(turn.status).toBe("done");
    }
    expect(useEditorStore.getState().doc.root.children.some((c) => c.kind === "heading")).toBe(true);
    expect(api.editDesign).toHaveBeenCalled();
  });

  it("applies multi-step create with last_column info rows without nesting", async () => {
    setSessionMe(signedInMe);
    vi.spyOn(api, "editDesign").mockResolvedValue({
      reply: "Built specs.",
      designBrief: {
        intent: "create",
        concept: "Property specs band.",
        bands: ["Specs"],
        notes: "",
      },
      steps: [
        {
          reasoning: "Root column spine.",
          summary: "Scaffold",
          ops: [
            { op: "toggle_auto_layout", id: "root", enabled: true },
            {
              op: "update_layout_props",
              id: "root",
              patch: { direction: "column", gap: 20, padding: 40, align: "stretch", justify: "start" },
            },
          ],
        },
        {
          reasoning: "Section + two info rows under last_column.",
          summary: "Specs",
          ops: [
            { op: "add_element", kind: "box", parentId: "root" },
            { op: "toggle_auto_layout", id: "last_created", enabled: true },
            {
              op: "update_layout_props",
              id: "last_created",
              patch: { direction: "column", gap: 12, padding: 0, align: "stretch", justify: "start" },
            },
            { op: "update_label", id: "last_created", label: "Specs" },
            { op: "add_element", kind: "heading", parentId: "last_created" },
            { op: "update_label", id: "last_created", label: "Specs" },
            { op: "add_element", kind: "box", parentId: "last_column" },
            { op: "resize_node", id: "last_created", w: 700, h: 32 },
            { op: "toggle_auto_layout", id: "last_created", enabled: true },
            {
              op: "update_layout_props",
              id: "last_created",
              patch: { direction: "row", gap: 0, padding: 0, align: "center", justify: "space-between" },
            },
            { op: "update_label", id: "last_created", label: "Row" },
            { op: "add_element", kind: "paragraph", parentId: "last_created" },
            { op: "update_label", id: "last_created", label: "Price" },
            { op: "add_element", kind: "paragraph", parentId: "last_created_sibling" },
            { op: "update_label", id: "last_created", label: "$100" },
            { op: "add_element", kind: "box", parentId: "last_column" },
            { op: "resize_node", id: "last_created", w: 700, h: 32 },
            { op: "toggle_auto_layout", id: "last_created", enabled: true },
            {
              op: "update_layout_props",
              id: "last_created",
              patch: { direction: "row", gap: 0, padding: 0, align: "center", justify: "space-between" },
            },
            { op: "update_label", id: "last_created", label: "Row" },
            { op: "add_element", kind: "paragraph", parentId: "last_created" },
            { op: "update_label", id: "last_created", label: "Beds" },
            { op: "add_element", kind: "paragraph", parentId: "last_created_sibling" },
            { op: "update_label", id: "last_created", label: "4" },
          ],
        },
      ],
    });

    const { result } = renderHook(() => useDesignChat());
    await act(async () => {
      await result.current.send("Create property specs");
    });
    await waitFor(() => expect(useChatStore.getState().loading).toBe(false));

    const section = useEditorStore.getState().doc.root.children[0]!;
    const rows = section.children.filter((c) => c.kind === "box");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.children.every((c) => c.kind === "paragraph"))).toBe(true);
    expect(rows.every((r) => r.w >= 100)).toBe(true);
    const turn = useChatStore.getState().messages.find((m) => m.type === "turn");
    expect(turn?.type === "turn" && turn.designBrief?.bands).toEqual(["Specs"]);
  });

  it("surfaces API errors on the turn and error message", async () => {
    setSessionMe(signedInMe);
    vi.spyOn(api, "editDesign").mockRejectedValue(new Error("quota exceeded"));
    const { result } = renderHook(() => useDesignChat());
    await act(async () => {
      await result.current.send("Make it bigger");
    });
    await waitFor(() => expect(useChatStore.getState().loading).toBe(false));
    const turn = useChatStore.getState().messages.find((m) => m.type === "turn");
    expect(turn?.type === "turn" && turn.status).toBe("failed");
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
    const turn = useChatStore.getState().messages.find((m) => m.type === "turn");
    expect(turn?.type).toBe("turn");
    if (turn?.type === "turn") {
      expect(turn.steps[0]?.status).toBe("done");
      expect(turn.steps[1]?.status).toBe("failed");
      expect(turn.steps[1]?.error).toMatch(/Unknown/);
      expect(turn.status).toBe("failed");
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
