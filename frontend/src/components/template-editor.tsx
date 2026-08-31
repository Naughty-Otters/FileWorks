"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TemplateShell } from "./template-shell";
import "@/design-pad/design-pad.css";
import Toolbar from "@/design-pad/components/Toolbar";
import Palette from "@/design-pad/components/Palette";
import Layers from "@/design-pad/components/Layers";
import Canvas from "@/design-pad/components/Canvas";
import Inspector from "@/design-pad/components/Inspector";
import JsonPanel from "@/design-pad/components/JsonPanel";
import TemplatePicker from "@/design-pad/components/TemplatePicker";
import VariablesPanel from "@/design-pad/components/VariablesPanel";
import DocumentPreview from "@/design-pad/components/DocumentPreview";
import ChatPanel from "@/design-pad/components/ChatPanel";
import { useChatStore } from "@/design-pad/chat/store";
import { builtInTemplate } from "@/design-pad/templates";
import { isStaticTemplate } from "@/design-pad/templating";
import { findNode, findParent, useEditorStore } from "@/design-pad/store";
import { createEmptyDocument, normalizeDocument } from "@/design-pad/types";
import { createTemplate, fetchTemplate, updateTemplate } from "@/lib/api";
import { PRODUCT } from "@/lib/product-copy";
import { useSession } from "@/lib/session";

const NUDGE = 8;
const NUDGE_LARGE = 32;

export function TemplateEditor({ templateId }: { templateId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  // Cloudflare Pages rewrites /templates/:id → /templates/new HTML for static
  // export; prefer the live URL so hard-refreshes still load the right design.
  const routeId = useMemo(() => {
    const segment = pathname?.match(/^\/templates\/([^/]+)/)?.[1];
    return segment ? decodeURIComponent(segment) : templateId;
  }, [pathname, templateId]);
  const { me, status } = useSession();
  const doc = useEditorStore((s) => s.doc);
  const selectedId = useEditorStore((s) => s.selectedId);
  const showTemplatePicker = useEditorStore((s) => s.showTemplatePicker);
  const showVariablesPanel = useEditorStore((s) => s.showVariablesPanel);
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const setShowTemplatePicker = useEditorStore((s) => s.setShowTemplatePicker);
  const select = useEditorStore((s) => s.select);
  const removeElement = useEditorStore((s) => s.removeElement);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const moveNode = useEditorStore((s) => s.moveNode);
  const reorderChild = useEditorStore((s) => s.reorderChild);

  const [id, setId] = useState(routeId === "new" ? null : routeId);
  const [name, setName] = useState<string>(PRODUCT.untitledDesign);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [jsonPanelOpen, setJsonPanelOpen] = useState(false);
  const [outputPreviewOpen, setOutputPreviewOpen] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const chatOpen = useChatStore((s) => s.open);
  const toggleChat = useChatStore((s) => s.toggleOpen);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      setError(null);
      if (routeId === "new") {
        const starter = new URLSearchParams(window.location.search).get("starter");
        const builtIn = starter ? builtInTemplate(starter) : null;
        if (builtIn) {
          loadDocument(builtIn.build());
          if (!cancelled) {
            setName(`${builtIn.name} copy`);
            setShowTemplatePicker(false);
          }
        } else {
          loadDocument(createEmptyDocument());
          if (!cancelled) setShowTemplatePicker(true);
        }
        if (!cancelled) setBootstrapped(true);
        return;
      }
      try {
        const template = await fetchTemplate(routeId);
        if (cancelled) return;
        loadDocument(normalizeDocument(template.document));
        setName(template.name);
        setShowTemplatePicker(false);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Failed to load design");
      } finally {
        if (!cancelled) setBootstrapped(true);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [loadDocument, setShowTemplatePicker, routeId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const isTyping = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (isTyping) return;

      if (
        selectedId &&
        (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")
      ) {
        const node = findNode(doc.root, selectedId);
        const parent = findParent(doc.root, selectedId);
        if (node && parent) {
          const freeform = parent.layout === null;
          if (freeform) {
            const step = e.shiftKey ? NUDGE_LARGE : NUDGE;
            let dx = 0;
            let dy = 0;
            if (e.key === "ArrowUp") dy = -step;
            else if (e.key === "ArrowDown") dy = step;
            else if (e.key === "ArrowLeft") dx = -step;
            else if (e.key === "ArrowRight") dx = step;
            e.preventDefault();
            moveNode(selectedId, Math.max(0, node.x + dx), Math.max(0, node.y + dy));
            return;
          }
          if (parent.layout) {
            const isRow = parent.layout.direction === "row";
            const reorderKey =
              (isRow && (e.key === "ArrowLeft" || e.key === "ArrowRight")) ||
              (!isRow && (e.key === "ArrowUp" || e.key === "ArrowDown"));
            if (reorderKey) {
              e.preventDefault();
              reorderChild(selectedId, e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : 1);
              return;
            }
          }
        }
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedId && selectedId !== "root") {
        e.preventDefault();
        removeElement(selectedId);
      } else if (e.key === "Escape") {
        if (selectedId) {
          const parent = findParent(doc.root, selectedId);
          select(parent && parent.id !== "root" ? parent.id : null);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, removeElement, select, doc, undo, redo, moveNode, reorderChild]);

  async function save() {
    if (!me?.user) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = id
        ? await updateTemplate(id, { name, document: doc })
        : await createTemplate({ name, document: doc });
      setId(saved.id);
      if (isStaticTemplate(doc)) {
        setNotice("Saved. This design is static, so its output ignores uploaded document content.");
      } else {
        setNotice("Design saved.");
      }
      if (!id) window.history.replaceState(null, "", `/templates/${encodeURIComponent(saved.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TemplateShell fixed>
      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3 md:px-5">
        {notice || error ? (
          <p className={`mb-2 shrink-0 px-1 text-xs ${error ? "text-[var(--danger)]" : "text-[var(--ink-muted)]"}`}>
            {error || notice}
          </p>
        ) : null}
        {!bootstrapped || status === "unknown" ? (
          <p className="px-2 text-sm text-[var(--ink-muted)]">Loading design editor…</p>
        ) : (
          <div className="design-pad min-h-0 flex-1">
            <Toolbar
              name={name}
              onNameChange={setName}
              onSave={save}
              saving={saving}
              jsonPanelOpen={jsonPanelOpen}
              onToggleJsonPanel={() => setJsonPanelOpen((v) => !v)}
              onOpenOutputPreview={() => setOutputPreviewOpen(true)}
              chatOpen={chatOpen}
              onToggleChat={toggleChat}
            />
            <div className="left-panel">
              <Palette />
              <Layers />
            </div>
            <div className="canvas-column">
              <Canvas />
              {chatOpen ? <ChatPanel /> : null}
            </div>
            <Inspector />
            {jsonPanelOpen ? <JsonPanel /> : null}
            {showVariablesPanel ? <VariablesPanel /> : null}
            {showTemplatePicker ? <TemplatePicker onPicked={setName} /> : null}
            {outputPreviewOpen ? (
              <DocumentPreview title={name} onClose={() => setOutputPreviewOpen(false)} />
            ) : null}
          </div>
        )}
      </main>
    </TemplateShell>
  );
}
