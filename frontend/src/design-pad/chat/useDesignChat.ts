"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { editDesign } from "@/lib/api";
import { useSession } from "@/lib/session";
import { applyDesignOps, resetAiIdSequence } from "../ops/executor";
import type { DesignEditStep } from "../ops/schema";
import { useEditorStore } from "../store";
import type { DesignEditStepWithStatus } from "./store";
import { useChatStore } from "./store";

function toConversation(messages: ReturnType<typeof useChatStore.getState>["messages"]) {
  const turns: { role: "user" | "assistant"; content: string }[] = [];
  for (const msg of messages) {
    if (msg.type !== "turn") continue;
    turns.push({ role: "user", content: msg.user });
    if (msg.reply) {
      const stepBits = msg.steps
        .map((step) => `${step.summary}: ${step.reasoning}`)
        .filter(Boolean)
        .join(" | ");
      const content = stepBits ? `${msg.reply}\n[steps] ${stepBits}` : msg.reply;
      turns.push({ role: "assistant", content });
    }
  }
  // Drop the in-flight turn (last user without reply yet).
  if (turns.length && turns[turns.length - 1]?.role === "user") {
    turns.pop();
  }
  return turns.slice(-8);
}

export function useDesignChat() {
  const router = useRouter();
  const { me } = useSession();
  const doc = useEditorStore((s) => s.doc);
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);

  const loading = useChatStore((s) => s.loading);
  const messages = useChatStore((s) => s.messages);
  const startTurn = useChatStore((s) => s.startTurn);
  const completeTurn = useChatStore((s) => s.completeTurn);
  const failTurn = useChatStore((s) => s.failTurn);
  const setTurnActivity = useChatStore((s) => s.setTurnActivity);
  const addErrorMessage = useChatStore((s) => s.addErrorMessage);
  const setLoading = useChatStore((s) => s.setLoading);
  const updateStepStatus = useChatStore((s) => s.updateStepStatus);
  const clearMessages = useChatStore((s) => s.clearMessages);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || loading) return;

      if (!me?.user) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }

      const turnId = startTurn(message);
      setLoading(true);

      try {
        const response = await editDesign({
          message,
          document: doc,
          selection_id: selectedId,
          conversation: toConversation(useChatStore.getState().messages),
        });

        const stepsWithStatus: DesignEditStepWithStatus[] = response.steps.map(
          (step: DesignEditStep) => ({
            ...step,
            status: step.ops.length > 0 ? "pending" : "done",
          }),
        );
        completeTurn(turnId, {
          reply: response.reply,
          designBrief: response.designBrief,
          steps: stepsWithStatus,
        });

        const actionable = stepsWithStatus.filter((step) => step.ops.length > 0).length;
        let applied = 0;
        resetAiIdSequence();
        let continueLastCreated: string | undefined;

        for (let i = 0; i < stepsWithStatus.length; i++) {
          const step = stepsWithStatus[i];
          if (step.ops.length === 0) {
            updateStepStatus(turnId, i, { status: "done" });
            continue;
          }
          applied += 1;
          setTurnActivity(turnId, `Applying ${applied}/${actionable}…`, "applying");
          updateStepStatus(turnId, i, { status: "applying" });
          const { results, affectedNodeIds, lastCreatedId } = await applyDesignOps(step.ops, {
            useAiIds: true,
            continueLastCreated,
          });
          if (lastCreatedId) continueLastCreated = lastCreatedId;
          const failed = results.find((r) => !r.ok);
          if (failed) {
            updateStepStatus(turnId, i, {
              status: "failed",
              error: failed.error ?? "Operation failed",
            });
          } else {
            updateStepStatus(turnId, i, { status: "done" });
            const lastAffected = affectedNodeIds.at(-1);
            if (lastAffected) select(lastAffected);
          }
        }
      } catch (e) {
        const err = e instanceof Error ? e.message : "Design edit failed";
        failTurn(turnId, err);
        addErrorMessage(err);
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
      startTurn,
      completeTurn,
      failTurn,
      setTurnActivity,
      addErrorMessage,
      setLoading,
      updateStepStatus,
      select,
    ],
  );

  return { send, loading, messages, clearMessages };
}
