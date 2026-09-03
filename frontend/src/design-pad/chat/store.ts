import { create } from "zustand";
import type { AgentTool, DesignEditBrief, DesignEditStep, DesignOp } from "../ops/schema";

export type StepStatus = "pending" | "applying" | "done" | "failed";

export type DesignEditStepWithStatus = DesignEditStep & {
  status: StepStatus;
  error?: string;
};

export type TurnStatus = "planning" | "applying" | "done" | "failed";

export type AgentTurn = {
  id: string;
  type: "turn";
  user: string;
  reply?: string;
  designBrief?: DesignEditBrief | null;
  steps: DesignEditStepWithStatus[];
  status: TurnStatus;
  activity?: string;
  error?: string;
};

export type ChatMessage =
  | AgentTurn
  | { id: string; type: "error"; content: string };

type ChatState = {
  open: boolean;
  messages: ChatMessage[];
  loading: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  startTurn: (user: string) => string;
  completeTurn: (
    turnId: string,
    payload: {
      reply: string;
      steps: DesignEditStepWithStatus[];
      designBrief?: DesignEditBrief | null;
    },
  ) => void;
  failTurn: (turnId: string, error: string) => void;
  setTurnActivity: (turnId: string, activity: string, status?: TurnStatus) => void;
  updateStepStatus: (
    turnId: string,
    stepIndex: number,
    patch: Partial<DesignEditStepWithStatus>,
  ) => void;
  addErrorMessage: (content: string) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
};

let msgCounter = 0;
function nextMsgId(): string {
  msgCounter += 1;
  return `msg_${Date.now().toString(36)}_${msgCounter}`;
}

export function formatToolLabel(tool: AgentTool): string {
  const name = String(tool.tool || "tool");
  const action = tool.action ? `:${tool.action}` : "";
  const target =
    (typeof tool.id === "string" && tool.id) ||
    (typeof tool.title === "string" && tool.title) ||
    (typeof tool.name === "string" && tool.name) ||
    (typeof tool.kind === "string" && tool.kind) ||
    (typeof tool.label === "string" && tool.label) ||
    (typeof tool.parentId === "string" && `→ ${tool.parentId}`) ||
    "";
  return target ? `${name}${action}(${target})` : `${name}${action}`;
}

export function formatOpLabel(op: DesignOp): string {
  switch (op.op) {
    case "add_element":
      return `add_element(${op.kind} → ${op.parentId})`;
    case "update_label":
      return `update_label(${op.id})`;
    case "update_style":
      return `update_style(${op.id})`;
    case "toggle_auto_layout":
      return `toggle_auto_layout(${op.id}, ${op.enabled ? "on" : "off"})`;
    case "update_layout_props":
      return `update_layout_props(${op.id})`;
    case "add_variable":
      return `add_variable(${op.name})`;
    case "update_variable":
      return `update_variable(${op.id})`;
    case "remove_variable":
      return `remove_variable(${op.id})`;
    case "move_in_tree":
      return `move_in_tree(${op.id} → ${op.parentId})`;
    case "select":
      return `select(${op.id})`;
    default:
      return "id" in op ? `${op.op}(${op.id})` : op.op;
  }
}

export const useChatStore = create<ChatState>((set) => ({
  open: true,
  messages: [],
  loading: false,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((s) => ({ open: !s.open })),
  startTurn: (user) => {
    const id = nextMsgId();
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id,
          type: "turn",
          user,
          steps: [],
          status: "planning",
          activity: "Thinking…",
        },
      ],
    }));
    return id;
  },
  completeTurn: (turnId, payload) =>
    set((s) => ({
      messages: s.messages.map((msg) => {
        if (msg.type !== "turn" || msg.id !== turnId) return msg;
        return {
          ...msg,
          reply: payload.reply,
          designBrief: payload.designBrief ?? null,
          steps: payload.steps,
          status: payload.steps.some((step) => step.ops.length > 0) ? "applying" : "done",
          activity: payload.steps.some((step) => step.ops.length > 0)
            ? "Applying…"
            : undefined,
        };
      }),
    })),
  failTurn: (turnId, error) =>
    set((s) => ({
      messages: s.messages.map((msg) => {
        if (msg.type !== "turn" || msg.id !== turnId) return msg;
        return { ...msg, status: "failed", error, activity: undefined };
      }),
    })),
  setTurnActivity: (turnId, activity, status) =>
    set((s) => ({
      messages: s.messages.map((msg) => {
        if (msg.type !== "turn" || msg.id !== turnId) return msg;
        return {
          ...msg,
          activity,
          ...(status ? { status } : {}),
        };
      }),
    })),
  updateStepStatus: (turnId, stepIndex, patch) =>
    set((s) => ({
      messages: s.messages.map((msg) => {
        if (msg.type !== "turn" || msg.id !== turnId) return msg;
        const steps = msg.steps.map((step, i) => (i === stepIndex ? { ...step, ...patch } : step));
        const allDone = steps.every((step) => step.status === "done" || step.status === "failed");
        const anyFailed = steps.some((step) => step.status === "failed");
        return {
          ...msg,
          steps,
          ...(allDone
            ? {
                status: anyFailed ? ("failed" as const) : ("done" as const),
                activity: undefined,
              }
            : {}),
        };
      }),
    })),
  addErrorMessage: (content) =>
    set((s) => ({
      messages: [...s.messages, { id: nextMsgId(), type: "error", content }],
    })),
  setLoading: (loading) => set({ loading }),
  clearMessages: () => set({ messages: [] }),
}));
