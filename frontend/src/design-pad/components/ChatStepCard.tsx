"use client";

import { useState } from "react";
import type { DesignEditStepWithStatus } from "../chat/store";
import { formatOpLabel, formatToolLabel } from "../chat/store";
import type { DesignOp } from "../ops/schema";

type Props = {
  step: DesignEditStepWithStatus;
  index: number;
  onSelectOp?: (op: DesignOp) => void;
};

export default function ChatStepCard({ step, index, onSelectOp }: Props) {
  const [reasoningOpen, setReasoningOpen] = useState(step.status !== "done");
  const [opsOpen, setOpsOpen] = useState(step.status === "applying" || step.status === "failed");
  const tools = step.tools ?? [];
  const showTools = tools.length > 0;

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
            Thinking
          </button>
          {reasoningOpen ? <p className="design-chat-reasoning-text">{step.reasoning}</p> : null}
        </div>
      ) : null}
      {step.error ? <p className="design-chat-step-error">{step.error}</p> : null}
      {showTools || step.ops.length > 0 ? (
        <div className="design-chat-step-ops">
          <button
            type="button"
            className="design-chat-reasoning-toggle"
            onClick={() => setOpsOpen((v) => !v)}
            aria-expanded={opsOpen}
          >
            {showTools
              ? `${tools.length} tool${tools.length === 1 ? "" : "s"}`
              : `${step.ops.length} op${step.ops.length === 1 ? "" : "s"}`}
          </button>
          {opsOpen ? (
            <ul className="design-chat-op-list">
              {showTools
                ? tools.map((tool, i) => (
                    <li key={`${step.summary}-tool-${i}`}>
                      <span className="design-chat-op-row">
                        <span className="design-chat-op-bullet" aria-hidden>
                          ●
                        </span>
                        <code>{formatToolLabel(tool)}</code>
                      </span>
                    </li>
                  ))
                : step.ops.map((op, i) => (
                    <li key={`${step.summary}-${i}`}>
                      <button
                        type="button"
                        className="design-chat-op-row"
                        onClick={() => onSelectOp?.(op)}
                      >
                        <span className="design-chat-op-bullet" aria-hidden>
                          ●
                        </span>
                        <code>{formatOpLabel(op)}</code>
                      </button>
                    </li>
                  ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
