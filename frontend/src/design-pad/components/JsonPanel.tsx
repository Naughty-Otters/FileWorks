"use client";

import { useEffect, useState } from "react";
import { useEditorStore } from "../store";
import { normalizeDocument } from "../types";

export default function JsonPanel() {
  const doc = useEditorStore((s) => s.doc);
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const [text, setText] = useState(() => JSON.stringify(doc, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(doc, null, 2));
  }, [doc]);

  function apply() {
    try {
      loadDocument(normalizeDocument(JSON.parse(text)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  return (
    <div className="json-panel">
      <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {error && <div className="json-error">{error}</div>}
      <div className="json-actions">
        <button type="button" onClick={apply}>
          Apply
        </button>
        <button type="button" onClick={() => setText(JSON.stringify(doc, null, 2))}>
          Revert
        </button>
      </div>
    </div>
  );
}
