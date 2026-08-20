"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { documentPageSize, documentToHtml, documentToMarkdown } from "../export-document";
import { downloadTextFile } from "@/lib/api";

/** Open the browser print dialog for HTML. Avoids `noopener` (which makes
 * `window.open` return null) and falls back to a hidden iframe when popups
 * are blocked. */
function printHtmlDocument(html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  // Do not pass "noopener" — modern browsers then return null and we cannot print.
  const win = window.open(url, "_blank");
  if (win) {
    const trigger = () => {
      try {
        win.focus();
        win.print();
      } catch {
        // ignore
      }
    };
    window.setTimeout(trigger, 400);
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;";
  iframe.src = url;
  document.body.appendChild(iframe);

  const cleanup = () => {
    URL.revokeObjectURL(url);
    iframe.remove();
  };

  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      // ignore
    } finally {
      window.setTimeout(cleanup, 1500);
    }
  };
}

export default function DocumentPreview({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) {
  const doc = useEditorStore((s) => s.doc);
  const page = useMemo(() => documentPageSize(doc), [doc]);
  const embedHtml = useMemo(
    () => documentToHtml(doc, title || "Document", { embed: true }),
    [doc, title],
  );
  const printHtml = useMemo(() => documentToHtml(doc, title || "Document"), [doc, title]);
  const markdown = useMemo(() => documentToMarkdown(doc), [doc]);

  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;

    const update = () => {
      const pad = 20;
      const availableW = Math.max(1, frame.clientWidth - pad * 2);
      const availableH = Math.max(1, frame.clientHeight - pad * 2);
      const next = Math.min(1, availableW / page.w, availableH / page.h);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [page.w, page.h]);

  function downloadMd() {
    downloadTextFile(
      markdown,
      `${(title || "document").replace(/\s+/g, "-").toLowerCase()}.md`,
      "text/markdown;charset=utf-8",
    );
  }

  return (
    <div className="template-overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="template-modal document-preview-modal">
        <button type="button" className="template-close" title="Close" onClick={onClose}>
          ×
        </button>
        <div className="document-preview-header">
          <div>
            <h2>Output preview</h2>
            <p>Final document with default values filled in. Download as PDF (print) or Markdown.</p>
          </div>
          <div className="document-preview-actions">
            <button type="button" className="chip-btn" onClick={downloadMd}>
              Download .md
            </button>
            <button
              type="button"
              className="chip-btn primary"
              title="Open print dialog — choose Save as PDF"
              onClick={() => printHtmlDocument(printHtml)}
            >
              Download PDF
            </button>
          </div>
        </div>
        <div className="document-preview-frame" ref={frameRef}>
          <div
            className="document-preview-scaler"
            style={{ width: page.w * scale, height: page.h * scale }}
          >
            <iframe
              title="Template output preview"
              srcDoc={embedHtml}
              sandbox="allow-same-origin allow-modals allow-popups"
              style={{
                width: page.w,
                height: page.h,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
