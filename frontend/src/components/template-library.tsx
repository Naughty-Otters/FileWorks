"use client";

import { useEffect, useState } from "react";
import { FilePlus2, LayoutTemplate, Trash2 } from "lucide-react";
import { TemplateShell } from "./template-shell";
import { BUILT_IN_TEMPLATES } from "@/design-pad/templates";
import { deleteTemplate, fetchTemplates, type TemplateRecord } from "@/lib/api";
import { useSession } from "@/lib/session";

export function TemplateLibrary() {
  const { me, status } = useSession();
  const [items, setItems] = useState<TemplateRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const signedIn = Boolean(me?.user);

  useEffect(() => {
    if (!signedIn) return;
    fetchTemplates().then(setItems).catch((reason) => setError(reason instanceof Error ? reason.message : "Failed to load templates"));
  }, [signedIn]);

  async function remove(item: TemplateRecord) {
    if (!window.confirm(`Delete “${item.name}”?`)) return;
    try {
      await deleteTemplate(item.id);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Delete failed");
    }
  }

  return (
    <TemplateShell>
      <main className="relative z-10 mx-auto w-full max-w-[1200px] flex-1 px-4 py-10 md:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent-strong)]">Template studio</p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight">Document templates</h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">Design reusable output layouts, then apply them to extracted Markdown in the workspace.</p>
          </div>
          <a href={signedIn ? "/templates/new" : "/login?next=%2Ftemplates%2Fnew"} className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white dark:text-[#06281d]">
            <FilePlus2 size={15} /> Blank template
          </a>
        </div>
        {error ? <p className="mt-5 text-sm text-[var(--danger)]">{error}</p> : null}

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Your templates</h2>
          {status === "unknown" ? <p className="mt-3 text-sm text-[var(--ink-muted)]">Loading account…</p> : !signedIn ? (
            <div className="panel mt-3 rounded-2xl p-6 text-sm text-[var(--ink-muted)]">
              <a href="/login?next=%2Ftemplates" className="font-medium text-[var(--accent-strong)] hover:underline">Sign in</a> to create, save, and use your templates.
            </div>
          ) : items.length ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <article key={item.id} className="panel rounded-2xl p-5">
                  <LayoutTemplate size={20} className="text-[var(--accent)]" />
                  <h3 className="mt-4 truncate font-semibold">{item.name}</h3>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">{item.updated_at ? `Updated ${new Date(item.updated_at).toLocaleDateString()}` : "Saved template"}</p>
                  <div className="mt-5 flex items-center gap-2">
                    <a href={`/templates/${encodeURIComponent(item.id)}`} className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)]">Open</a>
                    <button type="button" aria-label={`Delete ${item.name}`} onClick={() => remove(item)} className="ml-auto rounded-full p-2 text-[var(--ink-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--danger)]"><Trash2 size={14} /></button>
                  </div>
                </article>
              ))}
            </div>
          ) : <p className="mt-3 text-sm text-[var(--ink-muted)]">No saved templates yet. Start blank or copy a starter below.</p>}
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">Built-in starters</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {BUILT_IN_TEMPLATES.map((item) => (
              <article key={item.id} className="panel rounded-2xl p-5">
                <LayoutTemplate size={20} className="text-[var(--accent)]" />
                <h3 className="mt-4 font-semibold">{item.name}</h3>
                <p className="mt-1 min-h-10 text-sm text-[var(--ink-muted)]">{item.description}</p>
                <a href={signedIn ? `/templates/new?starter=${item.id}` : `/login?next=${encodeURIComponent(`/templates/new?starter=${item.id}`)}`} className="mt-5 inline-flex rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium hover:border-[var(--accent)] hover:text-[var(--accent-strong)]">Use starter</a>
              </article>
            ))}
          </div>
        </section>
      </main>
    </TemplateShell>
  );
}
