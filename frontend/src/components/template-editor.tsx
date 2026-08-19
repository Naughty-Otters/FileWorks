"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Eye, FileJson, Plus, Save, Trash2, Upload } from "lucide-react";
import { TemplateShell } from "./template-shell";
import { builtInTemplate } from "@/design-pad/templates";
import { expandSampleDocument, isStaticTemplate } from "@/design-pad/templating";
import { findNode, useEditorStore } from "@/design-pad/store";
import { normalizeDocument, nextId, VARIABLE_TYPES, type DesignNode, type ElementKind, type VariableSchemaField } from "@/design-pad/types";
import { createTemplate, downloadTextFile, fetchTemplate, updateTemplate } from "@/lib/api";
import { useSession } from "@/lib/session";

const fieldClass = "w-full rounded-lg border border-[var(--line)] bg-[var(--bg-elevated)] px-2.5 py-2 text-xs outline-none focus:border-[var(--accent)]";

export function TemplateEditor({ templateId }: { templateId: string }) {
  const router = useRouter();
  const { me, status } = useSession();
  const doc = useEditorStore((state) => state.doc);
  const selectedId = useEditorStore((state) => state.selectedId);
  const preview = useEditorStore((state) => state.preview);
  const load = useEditorStore((state) => state.load);
  const select = useEditorStore((state) => state.select);
  const setPreview = useEditorStore((state) => state.setPreview);
  const addNode = useEditorStore((state) => state.addNode);
  const updateNode = useEditorStore((state) => state.updateNode);
  const updateStyle = useEditorStore((state) => state.updateStyle);
  const removeNode = useEditorStore((state) => state.removeNode);
  const addVariable = useEditorStore((state) => state.addVariable);
  const updateVariable = useEditorStore((state) => state.updateVariable);
  const removeVariable = useEditorStore((state) => state.removeVariable);
  const [id, setId] = useState(templateId === "new" ? null : templateId);
  const [name, setName] = useState("Untitled template");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const selected = selectedId ? findNode(doc.root, selectedId) : null;
  const displayDoc = useMemo(() => preview ? expandSampleDocument(doc) : doc, [doc, preview]);

  useEffect(() => {
    if (templateId === "new") {
      const starter = new URLSearchParams(window.location.search).get("starter");
      const builtIn = starter ? builtInTemplate(starter) : null;
      if (builtIn) {
        queueMicrotask(() => {
          load(builtIn.build());
          setName(`${builtIn.name} copy`);
        });
      }
      return;
    }
    fetchTemplate(templateId)
      .then((template) => {
        load(normalizeDocument(template.document));
        setName(template.name);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Failed to load template"));
  }, [load, templateId]);

  async function save() {
    if (!me?.user) {
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = id ? await updateTemplate(id, { name, document: doc }) : await createTemplate({ name, document: doc });
      setId(saved.id);
      if (isStaticTemplate(doc)) setNotice("Saved. This template is static, so its output ignores uploaded document content.");
      else setNotice("Template saved.");
      if (!id) window.history.replaceState(null, "", `/templates/${encodeURIComponent(saved.id)}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function importJson(file: File) {
    file.text().then((text) => {
      load(normalizeDocument(JSON.parse(text)));
      setNotice("Template JSON imported. Save to persist it.");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Invalid template JSON"));
  }

  return (
    <TemplateShell fixed>
      <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-3 md:px-5">
        <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2">
          <a href="/templates" className="rounded-full px-3 py-2 text-xs text-[var(--ink-muted)] hover:bg-[var(--accent-soft)]">← Library</a>
          <input aria-label="Template name" value={name} onChange={(event) => setName(event.target.value)} className="min-w-44 flex-1 rounded-full border border-[var(--line)] bg-[var(--bg-panel)] px-4 py-2 text-sm font-medium outline-none focus:border-[var(--accent)]" />
          <button type="button" onClick={() => setPreview(!preview)} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-3 py-2 text-xs hover:border-[var(--accent)]"><Eye size={14} /> {preview ? "Design" : "Preview"}</button>
          <button type="button" onClick={() => downloadTextFile(JSON.stringify(doc, null, 2), `${name || "template"}.json`, "application/json")} className="rounded-full p-2" title="Export JSON"><Download size={15} /></button>
          <button type="button" onClick={() => importRef.current?.click()} className="rounded-full p-2" title="Import JSON"><Upload size={15} /></button>
          <input ref={importRef} hidden type="file" accept=".json,application/json" onChange={(event) => event.target.files?.[0] && importJson(event.target.files[0])} />
          <button type="button" disabled={saving || status === "unknown"} onClick={save} className="inline-flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:text-[#06281d]"><Save size={14} /> {saving ? "Saving…" : "Save"}</button>
        </div>
        {notice || error ? <p className={`mb-2 shrink-0 px-2 text-xs ${error ? "text-[var(--danger)]" : "text-[var(--ink-muted)]"}`}>{error || notice}</p> : null}

        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-[220px_minmax(0,1fr)_280px]">
          <aside className="panel min-h-0 overflow-auto rounded-2xl p-3">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Palette</h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["box", "heading", "paragraph", "image"] as ElementKind[]).map((kind) => <button key={kind} type="button" onClick={() => addNode(kind)} className="rounded-xl border border-[var(--line)] px-2 py-3 text-xs capitalize hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]">{kind}</button>)}
            </div>
            <h2 className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Layers</h2>
            <Layer node={doc.root} selectedId={selectedId} onSelect={select} depth={0} />
            <h2 className="mt-5 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Variables <button type="button" aria-label="Add variable" onClick={() => addVariable()} className="rounded-full p-1 hover:bg-[var(--accent-soft)]"><Plus size={13} /></button></h2>
            <div className="mt-2 space-y-2">
              {doc.variables.map((variable) => (
                <div key={variable.id} className="rounded-xl border border-[var(--line)] p-2">
                  <div className="flex gap-1">
                    <input aria-label={`${variable.label} name`} value={variable.name} onChange={(event) => updateVariable(variable.id, { name: event.target.value.replace(/[^\w]/g, "_") })} className={fieldClass} />
                    <button type="button" aria-label={`Remove ${variable.label}`} onClick={() => removeVariable(variable.id)}><Trash2 size={13} /></button>
                  </div>
                  <select value={variable.type} onChange={(event) => updateVariable(variable.id, { type: event.target.value as typeof variable.type })} className={`${fieldClass} mt-1`}>
                    {VARIABLE_TYPES.map((type) => <option key={type}>{type}</option>)}
                  </select>
                  <textarea aria-label={`${variable.name} sample value`} value={variable.sampleValue} onChange={(event) => updateVariable(variable.id, { sampleValue: event.target.value })} placeholder={variable.type === "list" ? '[{"field":"value"}]' : "Sample value"} className={`${fieldClass} mt-1 min-h-14 resize-y font-[family-name:var(--font-mono)]`} />
                  {variable.type === "list" ? <SchemaEditor fields={variable.itemSchema || []} onChange={(itemSchema) => updateVariable(variable.id, { itemSchema })} /> : null}
                </div>
              ))}
            </div>
          </aside>

          <section className="panel min-h-0 overflow-auto rounded-2xl bg-[color-mix(in_oklab,var(--bg)_78%,transparent)] p-5">
            <div className="mx-auto origin-top bg-white shadow-xl" style={{ width: displayDoc.pageSize.w, minHeight: displayDoc.pageSize.h, transform: "scale(.72)", marginBottom: -displayDoc.pageSize.h * .28 }}>
              <NodeView node={displayDoc.root} root selectedId={selectedId} preview={preview} onSelect={select} />
            </div>
          </section>

          <aside className="panel min-h-0 overflow-auto rounded-2xl p-4">
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Inspector</h2>
            {selected ? (
              <div className="mt-3 space-y-3">
                <label className="block text-xs text-[var(--ink-muted)]">Content<textarea value={selected.label} onChange={(event) => updateNode(selected.id, { label: event.target.value })} className={`${fieldClass} mt-1 min-h-24 resize-y`} /></label>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="Width" value={selected.w} onChange={(w) => updateNode(selected.id, { w })} />
                  <NumberField label="Height" value={selected.h} onChange={(h) => updateNode(selected.id, { h })} />
                  <NumberField label="X" value={selected.x} onChange={(x) => updateNode(selected.id, { x })} />
                  <NumberField label="Y" value={selected.y} onChange={(y) => updateNode(selected.id, { y })} />
                </div>
                <label className="block text-xs text-[var(--ink-muted)]">Text color<input type="color" value={selected.style.color} onChange={(event) => updateStyle(selected.id, { color: event.target.value })} className="mt-1 h-9 w-full" /></label>
                <NumberField label="Font size" value={selected.style.fontSize} onChange={(fontSize) => updateStyle(selected.id, { fontSize })} />
                {selected.kind === "box" ? (
                  <div className="rounded-xl border border-[var(--line)] p-3">
                    <p className="text-xs font-medium">Repeat this box</p>
                    <input value={selected.repeat?.over || ""} onChange={(event) => updateNode(selected.id, { repeat: event.target.value ? { over: event.target.value, as: selected.repeat?.as || "item" } : undefined })} placeholder="List variable, e.g. items" className={`${fieldClass} mt-2`} />
                    <input value={selected.repeat?.as || ""} onChange={(event) => updateNode(selected.id, { repeat: selected.repeat ? { ...selected.repeat, as: event.target.value } : undefined })} placeholder="Item alias, e.g. item" className={`${fieldClass} mt-1`} />
                    <p className="mt-2 text-[11px] text-[var(--ink-muted)]">Use tokens like {"{{ item.name }}"}. Structural loops only.</p>
                  </div>
                ) : null}
                {selected.id !== "root" ? <button type="button" onClick={() => removeNode(selected.id)} className="inline-flex items-center gap-1.5 text-xs text-[var(--danger)]"><Trash2 size={13} /> Delete layer</button> : null}
              </div>
            ) : <p className="mt-3 text-sm text-[var(--ink-muted)]">Select a layer to edit content, geometry, style, or repeat behavior.</p>}
            <div className="mt-6 rounded-xl border border-[var(--line)] p-3 text-xs text-[var(--ink-muted)]"><FileJson size={15} className="mb-2 text-[var(--accent)]" />JSON import/export preserves the complete DesignDocument v2.</div>
          </aside>
        </div>
      </main>
    </TemplateShell>
  );
}

function Layer({ node, selectedId, onSelect, depth }: { node: DesignNode; selectedId: string | null; onSelect: (id: string) => void; depth: number }) {
  return <div className="mt-1"><button type="button" onClick={() => onSelect(node.id)} className={`w-full truncate rounded-lg px-2 py-1.5 text-left text-xs ${selectedId === node.id ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "hover:bg-[var(--accent-soft)]"}`} style={{ paddingLeft: 8 + depth * 12 }}>{node.label || node.kind}{node.repeat ? " ↻" : ""}</button>{node.children.map((child) => <Layer key={child.id} node={child} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />)}</div>;
}

function NodeView({ node, root = false, selectedId, preview, onSelect }: { node: DesignNode; root?: boolean; selectedId: string | null; preview: boolean; onSelect: (id: string) => void }) {
  const common: React.CSSProperties = {
    position: root ? "relative" : "absolute", left: root ? undefined : node.x, top: root ? undefined : node.y, width: root ? "100%" : node.w, height: root ? "100%" : node.h,
    color: node.style.color, background: node.style.backgroundColor, border: `${node.style.borderWidth}px ${node.style.borderStyle} ${node.style.borderColor}`, fontFamily: node.style.fontFamily, fontSize: node.style.fontSize,
    fontWeight: node.style.bold ? 700 : 400, fontStyle: node.style.italic ? "italic" : "normal", textDecoration: node.style.underline ? "underline" : "none", textAlign: node.style.align, outline: !preview && selectedId === node.id ? "2px solid #0f6e56" : undefined, overflow: "hidden",
  };
  return <div style={common} onClick={(event) => { event.stopPropagation(); if (!preview) onSelect(node.id); }}>
    {node.kind === "image" ? node.imageSrc ? <img src={node.imageSrc} alt={node.label} style={{ width: "100%", height: "100%", objectFit: node.objectFit }} /> : <span className="flex h-full items-center justify-center text-slate-400">Image</span> : node.kind !== "box" ? <span className="whitespace-pre-wrap">{node.label}</span> : null}
    {layoutChildren(node).map((child) => <NodeView key={child.id} node={child} selectedId={selectedId} preview={preview} onSelect={onSelect} />)}
  </div>;
}

function layoutChildren(node: DesignNode): DesignNode[] {
  if (!node.layout) return node.children;
  let cursor = node.layout.padding;
  return node.children.map((child) => {
    const copy = { ...child };
    if (node.layout!.direction === "column") {
      copy.x = node.layout!.padding;
      copy.y = cursor;
      if (node.layout!.align === "stretch") copy.w = Math.max(20, node.w - node.layout!.padding * 2);
      cursor += copy.h + node.layout!.gap;
    } else {
      copy.x = cursor;
      copy.y = node.layout!.padding;
      if (node.layout!.align === "stretch") copy.h = Math.max(20, node.h - node.layout!.padding * 2);
      cursor += copy.w + node.layout!.gap;
    }
    return copy;
  });
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="block text-xs text-[var(--ink-muted)]">{label}<input type="number" value={Math.round(value)} onChange={(event) => onChange(Number(event.target.value))} className={`${fieldClass} mt-1`} /></label>;
}

function SchemaEditor({ fields, onChange }: { fields: VariableSchemaField[]; onChange: (fields: VariableSchemaField[]) => void }) {
  return <div className="mt-2 border-t border-[var(--line)] pt-2"><div className="flex items-center justify-between"><p className="text-[11px] text-[var(--ink-muted)]">Item schema</p><button type="button" onClick={() => onChange([...fields, { id: nextId("field"), name: "field", label: "Field", type: "text" }])}><Plus size={12} /></button></div>{fields.map((field) => <div key={field.id} className="mt-1 grid grid-cols-[1fr_76px_auto] gap-1"><input aria-label="Schema field name" value={field.name} onChange={(event) => onChange(fields.map((item) => item.id === field.id ? { ...item, name: event.target.value, label: event.target.value } : item))} className={fieldClass} /><select aria-label={`${field.name} field type`} value={field.type} onChange={(event) => onChange(fields.map((item) => item.id === field.id ? { ...item, type: event.target.value as VariableSchemaField["type"] } : item))} className={fieldClass}>{VARIABLE_TYPES.filter((type) => type !== "list").map((type) => <option key={type}>{type}</option>)}</select><button type="button" aria-label={`Remove ${field.name} field`} onClick={() => onChange(fields.filter((item) => item.id !== field.id))}><Trash2 size={12} /></button></div>)}</div>;
}
