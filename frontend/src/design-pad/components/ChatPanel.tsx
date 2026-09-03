"use client";

import { useEffect, useRef, useState } from "react";
import { findNode, useEditorStore } from "../store";
import { useDesignChat } from "../chat/useDesignChat";
import type { DesignOp } from "../ops/schema";
import ChatStepCard from "./ChatStepCard";

export default function ChatPanel() {
  const { send, loading, messages, clearMessages } = useDesignChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const doc = useEditorStore((s) => s.doc);
  const selectedId = useEditorStore((s) => s.selectedId);
  const select = useEditorStore((s) => s.select);

  const selectedLabel = selectedId
    ? (() => {
        const node = findNode(doc.root, selectedId);
        if (!node) return null;
        const label = node.label.trim().slice(0, 40) || node.kind;
        return `${node.kind}: ${label}`;
      })()
    : null;

  const activeTurn = [...messages].reverse().find((m) => m.type === "turn");
  const statusText =
    loading && activeTurn?.type === "turn"
      ? activeTurn.activity || "Thinking…"
      : loading
        ? "Thinking…"
        : "Idle";

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function handleSubmit() {
    const text = draft.trim();
    if (!text || loading) return;
    setDraft("");
    await send(text);
    inputRef.current?.focus();
  }

  function onSelectOp(op: DesignOp) {
    if ("id" in op && typeof op.id === "string" && op.id !== "last_created" && op.id !== "last_created_sibling") {
      select(op.id);
    }
  }

  return (
    <div className="design-chat-dock design-chat-agent">
      <header className="design-chat-agent-header">
        <div className="design-chat-agent-title">
          <span className="design-chat-agent-name">Design agent</span>
          <span className={`design-chat-agent-status${loading ? " is-busy" : ""}`}>{statusText}</span>
        </div>
        <button
          type="button"
          className="design-chat-agent-clear"
          onClick={() => clearMessages()}
          disabled={loading || messages.length === 0}
        >
          Clear
        </button>
      </header>

      <div className="design-chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="design-chat-empty">
            <p>Describe a layout change. The agent plans structure, components, labels, and variables together.</p>
            <p className="design-chat-empty-hint">Try: “Add a header with title and invoice date variable”</p>
          </div>
        ) : (
          messages.map((msg) => {
            if (msg.type === "error") {
              return (
                <div key={msg.id} className="design-chat-turn design-chat-turn--error">
                  <div className="design-chat-turn-error">{msg.content}</div>
                </div>
              );
            }

            return (
              <article key={msg.id} className={`design-chat-turn design-chat-turn--${msg.status}`}>
                <div className="design-chat-user-line">
                  <span className="design-chat-user-prefix">›</span>
                  <span>{msg.user}</span>
                </div>

                {msg.status === "planning" ? (
                  <p className="design-chat-activity">{msg.activity || "Thinking…"}</p>
                ) : null}

                {msg.designBrief?.concept ? (
                  <div className="design-chat-brief">
                    <div className="design-chat-brief-label">Design plan</div>
                    <p className="design-chat-brief-concept">{msg.designBrief.concept}</p>
                    {msg.designBrief.bands?.length ? (
                      <ol className="design-chat-brief-bands">
                        {msg.designBrief.bands.map((band) => (
                          <li key={band}>{band}</li>
                        ))}
                      </ol>
                    ) : null}
                  </div>
                ) : null}

                {msg.steps.length > 0 ? (
                  <div className="design-chat-steps">
                    {msg.steps.map((step, i) => (
                      <ChatStepCard
                        key={`${msg.id}-${i}`}
                        step={step}
                        index={i}
                        onSelectOp={onSelectOp}
                      />
                    ))}
                  </div>
                ) : null}

                {msg.activity && msg.status === "applying" ? (
                  <p className="design-chat-activity">{msg.activity}</p>
                ) : null}

                {msg.reply ? <p className="design-chat-reply">{msg.reply}</p> : null}
                {msg.error ? <p className="design-chat-turn-error">{msg.error}</p> : null}
              </article>
            );
          })
        )}
      </div>

      <form
        className="design-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void handleSubmit();
        }}
      >
        <div className="design-chat-context">
          {selectedLabel ? <span className="design-chat-chip">Selected: {selectedLabel}</span> : null}
          <span className="design-chat-chip">
            {doc.variables.length} variable{doc.variables.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="design-chat-input-row">
          <textarea
            ref={inputRef}
            className="design-chat-input"
            placeholder="Ask the agent — Enter to send, Shift+Enter for newline"
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={loading}
            aria-label="Design agent prompt"
          />
          <button type="submit" className="design-chat-send" disabled={loading || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
