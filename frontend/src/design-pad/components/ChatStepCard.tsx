"use client";

import { useState } from "react";
import type { DesignEditStepWithStatus } from "../chat/store";

type Props = {
  step: DesignEditStepWithStatus;
  index: number;
};

export default function ChatStepCard({ step, index }: Props) {
  const [reasoningOpen, setReasoningOpen] = useState(step.status !== "done");

  const statusLabel =
    step.status === "pending"
      ? "Pending"
      : step.status === "applying"
        ? "Applying…"
        : step.status === "failed"
          ? "Failed"
          : "Done";

  return (
    <div className={`design-chat-step design-chat-step--${step.status}`}>
      <div className="design-chat-step-header">
        <span className="design-chat-step-index">{index + 1}</span>
        <span className="design-chat-step-summary">{step.summary}</span>
        <span className={`design-chat-step-status design-chat-step-status--${step.status}`}>
          {statusLabel}
        </span>
      </div>
      {step.reasoning ? (
        <div className="design-chat-step-reasoning">
          <button
            type="button"
            className="design-chat-reasoning-toggle"
            onClick={() => setReasoningOpen((v) => !v)}
            aria-expanded={reasoningOpen}
          >
            Reasoning
          </button>
          {reasoningOpen ? <p className="design-chat-reasoning-text">{step.reasoning}</p> : null}
        </div>
      ) : null}
      {step.error ? <p className="design-chat-step-error">{step.error}</p> : null}
      {step.ops.length > 0 ? (
        <p className="design-chat-step-ops">
          {step.ops.length} operation{step.ops.length === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}
