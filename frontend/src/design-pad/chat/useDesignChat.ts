"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { editDesign } from "@/lib/api";
import { useSession } from "@/lib/session";
import { applyDesignOps } from "../ops/executor";
import type { DesignEditStep } from "../ops/schema";
import { useEditorStore } from "../store";
import type { DesignEditStepWithStatus } from "./store";
import { useChatStore } from "./store";

function toConversation(messages: ReturnType<typeof useChatStore.getState>["messages"]) {
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of messages) {
    if (msg.type === "user") turns.push({ role: "user", content: msg.content });
    if (msg.type === "assistant") turns.push({ role: "assistant", content: msg.content });
  }
  return turns.slice(0, -1);
}

export function useDesignChat() {
  const router = useRouter();
  const { me } = useSession();
  const doc = useEditorStore((s) => s.doc);
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);

  const loading = useChatStore((s) => s.loading);
  const messages = useChatStore((s) => s.messages);
  const addUserMessage = useChatStore((s) => s.addUserMessage);
  const addAssistantMessage = useChatStore((s) => s.addAssistantMessage);
  const addStepsMessage = useChatStore((s) => s.addStepsMessage);
  const addErrorMessage = useChatStore((s) => s.addErrorMessage);
  const setLoading = useChatStore((s) => s.setLoading);
  const updateStepStatus = useChatStore((s) => s.updateStepStatus);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || loading) return;

      if (!me?.user) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }

      addUserMessage(message);
      setLoading(true);

      try {
        const response = await editDesign({
          message,
          document: doc,
          selection_id: selectedId,
          conversation: toConversation(useChatStore.getState().messages),
        });

        addAssistantMessage(response.reply);

        const stepsWithStatus: DesignEditStepWithStatus[] = response.steps.map((step: DesignEditStep) => ({
          ...step,
          status: step.ops.length > 0 ? "pending" : "done",
        }));
        const messageId = addStepsMessage(stepsWithStatus);
        if (!messageId) return;

        for (let i = 0; i < stepsWithStatus.length; i++) {
          const step = stepsWithStatus[i];
          if (step.ops.length === 0) {
            updateStepStatus(messageId, i, { status: "done" });
            continue;
          }
          updateStepStatus(messageId, i, { status: "applying" });
          const { results, affectedNodeIds } = await applyDesignOps(step.ops);
          const failed = results.find((r) => !r.ok);
          if (failed) {
            updateStepStatus(messageId, i, {
              status: "failed",
              error: failed.error ?? "Operation failed",
            });
          } else {
            updateStepStatus(messageId, i, { status: "done" });
            const lastAffected = affectedNodeIds.at(-1);
            if (lastAffected) select(lastAffected);
          }
        }
      } catch (e) {
        addErrorMessage(e instanceof Error ? e.message : "Design edit failed");
      } finally {
        setLoading(false);
      }
    },
    [
      loading,
      me?.user,
      router,
      doc,
      selectedId,
      addUserMessage,
      addAssistantMessage,
      addStepsMessage,
      addErrorMessage,
      setLoading,
      updateStepStatus,
      select,
    ],
  );

  return { send, loading, messages };
}
