"use client";

import { useEffect, useRef, useState } from "react";
import { findNode, useEditorStore } from "../store";
import { useChatStore } from "../chat/store";
import { useDesignChat } from "../chat/useDesignChat";
import ChatStepCard from "./ChatStepCard";

export default function ChatPanel() {
  const { send, loading, messages } = useDesignChat();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const doc = useEditorStore((s) => s.doc);
  const selectedId = useEditorStore((s) => s.selectedId);

  const selectedLabel = selectedId
    ? (() => {
        const node = findNode(doc.root, selectedId);
        if (!node) return null;
        const label = node.label.trim().slice(0, 40) || node.kind;
        return `${node.kind}: ${label}`;
      })()
    : null;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await send(text);
  }

  return (
    <div className="design-chat-dock">
      <div className="design-chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <p className="design-chat-empty">
            Describe the change you want — layout, typography, variables, or structure.
          </p>
        ) : (
          messages.map((msg) => {
            if (msg.type === "user") {
              return (
                <div key={msg.id} className="design-chat-bubble design-chat-bubble--user">
                  {msg.content}
                </div>
              );
            }
            if (msg.type === "assistant") {
              return (
                <div key={msg.id} className="design-chat-bubble design-chat-bubble--assistant">
                  {msg.content}
                </div>
              );
            }
            if (msg.type === "error") {
              return (
                <div key={msg.id} className="design-chat-bubble design-chat-bubble--error">
                  {msg.content}
                </div>
              );
            }
            return (
              <div key={msg.id} className="design-chat-steps">
                {msg.steps.map((step, i) => (
                  <ChatStepCard key={`${msg.id}-${i}`} step={step} index={i} />
                ))}
              </div>
            );
          })
        )}
        {loading ? <p className="design-chat-loading">Thinking…</p> : null}
      </div>

      <form className="design-chat-form" onSubmit={handleSubmit}>
        <div className="design-chat-context">
          {selectedLabel ? <span className="design-chat-chip">Selected: {selectedLabel}</span> : null}
          <span className="design-chat-chip">
            {doc.variables.length} variable{doc.variables.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="design-chat-input-row">
          <input
            type="text"
            className="design-chat-input"
            placeholder="Edit with words — e.g. center the title and add a date variable"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={loading}
            aria-label="Design edit prompt"
          />
          <button type="submit" className="design-chat-send" disabled={loading || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
