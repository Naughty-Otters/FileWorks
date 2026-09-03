"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, Trash2 } from "lucide-react";
import { TemplateShell } from "./template-shell";
import { SeoFaq } from "@/components/seo-faq";
import { BUILT_IN_TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from "@/design-pad/templates";
import { deleteTemplate, fetchTemplates, type TemplateRecord } from "@/lib/api";
import { PRODUCT } from "@/lib/product-copy";
import { useSession } from "@/lib/session";
import { TEMPLATE_FAQS } from "@/lib/seo";

function categoryAnchorId(categoryId: TemplateCategory) {
  return `design-cat-${categoryId}`;
}

function asTemplateCategory(value: string | null | undefined): TemplateCategory | null {
  if (!value) return null;
  return TEMPLATE_CATEGORIES.some((cat) => cat.id === value) ? (value as TemplateCategory) : null;
}

export function TemplateLibrary() {
  const { me, status } = useSession();
  const [items, setItems] = useState<TemplateRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const signedIn = Boolean(me?.user);

  const populatedCategories = useMemo(
    () =>
      TEMPLATE_CATEGORIES.filter((cat) =>
        BUILT_IN_TEMPLATES.some((item) => item.category === cat.id),
      ),
    [],
  );
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | "">(
    populatedCategories[0]?.id ?? "",
  );
  const clickingRef = useRef(false);

  useEffect(() => {
    if (!signedIn) return;
    fetchTemplates()
      .then(setItems)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Failed to load designs"));
  }, [signedIn]);

  useEffect(() => {
    const nodes = populatedCategories
      .map((cat) => document.getElementById(categoryAnchorId(cat.id)))
      .filter((node): node is HTMLElement => Boolean(node));
    if (!nodes.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (clickingRef.current) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = asTemplateCategory(visible[0]?.target.getAttribute("data-category-id"));
        if (top) setActiveCategory(top);
      },
      {
        // Account for sticky site header + category index.
        rootMargin: "-120px 0px -55% 0px",
        threshold: [0.1, 0.25, 0.5],
      },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [populatedCategories]);

  function scrollToCategory(categoryId: TemplateCategory) {
    const target = document.getElementById(categoryAnchorId(categoryId));
    if (!target) return;
    clickingRef.current = true;
    setActiveCategory(categoryId);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => {
      clickingRef.current = false;
    }, 700);
  }

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
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--accent-strong)]">
              {PRODUCT.studio}
            </p>
            <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight">
              {PRODUCT.documentDesigns}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[var(--ink-muted)]">{PRODUCT.oneLiner}</p>
          </div>
          <a
            href={signedIn ? "/templates/new" : "/login?next=%2Ftemplates%2Fnew"}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white dark:text-[#06281d]"
          >
            <FilePlus2 size={15} /> {PRODUCT.newDesign}
          </a>
        </div>
        {error ? <p className="mt-5 text-sm text-[var(--danger)]">{error}</p> : null}

        <section className="mt-10">
          <h2 className="text-lg font-semibold">{PRODUCT.yourDesigns}</h2>
          {status === "unknown" ? (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">Loading account…</p>
          ) : !signedIn ? (
            <div className="panel mt-3 rounded-2xl p-6 text-sm text-[var(--ink-muted)]">
              <a href="/login?next=%2Ftemplates" className="font-medium text-[var(--accent-strong)] hover:underline">
                Sign in
              </a>{" "}
              to create, save, and use your designs.
            </div>
          ) : items.length ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <article
                  key={item.id}
                  className="panel group rounded-2xl p-4 transition hover:-translate-y-0.5 hover:border-[var(--accent)]"
                >
                  <div className="flex h-[70px] flex-col justify-center gap-1.5 rounded-lg bg-[color-mix(in_oklab,var(--bg)_70%,#94a3b8_30%)] px-3 py-2">
                    <div className="h-2 w-[70%] rounded-sm bg-[color-mix(in_oklab,var(--ink-muted)_55%,transparent)]" />
                    <div className="h-1.5 w-full rounded-sm bg-[color-mix(in_oklab,var(--ink-muted)_35%,transparent)]" />
                    <div className="h-1.5 w-[60%] rounded-sm bg-[color-mix(in_oklab,var(--ink-muted)_35%,transparent)]" />
                  </div>
                  <h3 className="mt-3 truncate font-semibold">{item.name}</h3>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {item.updated_at
                      ? `Updated ${new Date(item.updated_at).toLocaleDateString()}`
                      : PRODUCT.savedDesign}
                  </p>
                  <div className="mt-4 flex items-center gap-2">
                    <a
                      href={`/templates/${encodeURIComponent(item.id)}`}
                      className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)]"
                    >
                      Open
                    </a>
                    <button
                      type="button"
                      aria-label={`Delete ${item.name}`}
                      onClick={() => remove(item)}
                      className="ml-auto rounded-full p-2 text-[var(--ink-muted)] hover:bg-[var(--accent-soft)] hover:text-[var(--danger)]"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">
              No saved designs yet. Start blank or copy a starter below.
            </p>
          )}
        </section>

        <section className="mt-10">
          <h2 className="text-lg font-semibold">{PRODUCT.starterDesigns}</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Ready-to-fill layouts by document type — agreements, plans, policies, forms, and more.
            Produce from a file on Home, or copy a starter into the studio to refine.
          </p>

          <nav
            aria-label="Design categories"
            className="sticky top-0 z-20 -mx-1 mt-5 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--bg)_92%,transparent)] px-1 py-3 backdrop-blur-md"
          >
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
              {populatedCategories.map((cat) => {
                const active = activeCategory === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => scrollToCategory(cat.id)}
                    aria-current={active ? "true" : undefined}
                    className={
                      active
                        ? "shrink-0 rounded-full border border-[var(--accent)] bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)]"
                        : "shrink-0 rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent-strong)]"
                    }
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>
          </nav>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            <a
              href={signedIn ? "/templates/new" : "/login?next=%2Ftemplates%2Fnew"}
              className="panel flex flex-col rounded-2xl p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]"
            >
              <div className="flex h-[70px] items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--bg)_70%,#94a3b8_30%)] text-[var(--ink-muted)]">
                <FilePlus2 size={28} />
              </div>
              <h3 className="mt-3 font-semibold">{PRODUCT.blankPage}</h3>
              <p className="mt-1 min-h-10 text-sm text-[var(--ink-muted)]">Choose a page size and build from scratch</p>
            </a>
          </div>
          {populatedCategories.map((cat) => {
            const categoryItems = BUILT_IN_TEMPLATES.filter((item) => item.category === cat.id);
            return (
              <div
                key={cat.id}
                id={categoryAnchorId(cat.id)}
                data-category-id={cat.id}
                className="mt-8 scroll-mt-28"
              >
                <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                  {cat.label}
                </h3>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">{cat.blurb}</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {categoryItems.map((item) => {
                    const editHref = signedIn
                      ? `/templates/new?starter=${encodeURIComponent(item.id)}`
                      : `/login?next=${encodeURIComponent(`/templates/new?starter=${item.id}`)}`;
                    return (
                    <article
                      key={item.id}
                      className="panel flex flex-col rounded-2xl p-4 text-left transition hover:-translate-y-0.5 hover:border-[var(--accent)]"
                    >
                      <a href={editHref} className="block min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                        <div className="flex h-[70px] flex-col justify-center gap-1.5 rounded-lg bg-[color-mix(in_oklab,var(--bg)_70%,#94a3b8_30%)] px-3 py-2">
                          <div className="h-2.5 w-[70%] rounded-sm bg-[color-mix(in_oklab,var(--ink-muted)_55%,transparent)]" />
                          <div className="h-1.5 w-full rounded-sm bg-[color-mix(in_oklab,var(--ink-muted)_35%,transparent)]" />
                          <div className="h-1.5 w-[60%] rounded-sm bg-[color-mix(in_oklab,var(--ink-muted)_35%,transparent)]" />
                          <div className="h-1.5 w-full rounded-sm bg-[color-mix(in_oklab,var(--ink-muted)_35%,transparent)]" />
                        </div>
                        <h3 className="mt-3 font-semibold">{item.name}</h3>
                        <p className="mt-1 min-h-10 text-sm text-[var(--ink-muted)]">{item.description}</p>
                      </a>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <a
                          href={`/?produce=${encodeURIComponent(item.id)}`}
                          className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white dark:text-[#06281d]"
                        >
                          {PRODUCT.produceFromFile}
                        </a>
                        <a
                          href={editHref}
                          className="rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-medium text-[var(--accent-strong)]"
                        >
                          {PRODUCT.editInStudio}
                        </a>
                      </div>
                    </article>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <div className="mt-12">
          <SeoFaq title="Design FAQ" items={TEMPLATE_FAQS} />
        </div>
      </main>
    </TemplateShell>
  );
}
