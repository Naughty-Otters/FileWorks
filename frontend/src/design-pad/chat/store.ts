import { create } from "zustand";
import type { DesignEditStep } from "../ops/schema";

export type ChatMessage =
  | { id: string; type: "user"; content: string }
  | { id: string; type: "assistant"; content: string }
  | {
      id: string;
      type: "steps";
      steps: DesignEditStepWithStatus[];
    }
  | { id: string; type: "error"; content: string };

export type StepStatus = "pending" | "applying" | "done" | "failed";

export type DesignEditStepWithStatus = DesignEditStep & {
  status: StepStatus;
  error?: string;
};

type ChatState = {
  open: boolean;
  messages: ChatMessage[];
  loading: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  addUserMessage: (content: string) => void;
  addAssistantMessage: (content: string) => void;
  addStepsMessage: (steps: DesignEditStepWithStatus[]) => string;
  addErrorMessage: (content: string) => void;
  setLoading: (loading: boolean) => void;
  updateStepStatus: (messageId: string, stepIndex: number, patch: Partial<DesignEditStepWithStatus>) => void;
  clearMessages: () => void;
};

let msgCounter = 0;
function nextMsgId(): string {
  msgCounter += 1;
  return `msg_${Date.now().toString(36)}_${msgCounter}`;
}

export const useChatStore = create<ChatState>((set) => ({
  open: true,
  messages: [],
  loading: false,
  setOpen: (open) => set({ open }),
  toggleOpen: () => set((s) => ({ open: !s.open })),
  addUserMessage: (content) =>
    set((s) => ({
      messages: [...s.messages, { id: nextMsgId(), type: "user", content }],
    })),
  addAssistantMessage: (content) =>
    set((s) => ({
      messages: [...s.messages, { id: nextMsgId(), type: "assistant", content }],
    })),
  addStepsMessage: (steps) => {
    const id = nextMsgId();
    set((s) => ({
      messages: [...s.messages, { id, type: "steps", steps }],
    }));
    return id;
  },
  addErrorMessage: (content) =>
    set((s) => ({
      messages: [...s.messages, { id: nextMsgId(), type: "error", content }],
    })),
  setLoading: (loading) => set({ loading }),
  updateStepStatus: (messageId, stepIndex, patch) =>
    set((s) => ({
      messages: s.messages.map((msg) => {
        if (msg.type !== "steps" || msg.id !== messageId) return msg;
        const steps = msg.steps.map((step, i) => (i === stepIndex ? { ...step, ...patch } : step));
        return { ...msg, steps };
      }),
    })),
  clearMessages: () => set({ messages: [] }),
}));
