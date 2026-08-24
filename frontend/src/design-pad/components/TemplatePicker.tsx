"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { TEMPLATES, TEMPLATE_CATEGORIES, type Template, type TemplateCategory } from "../templates";
import { PAGE_SIZE_PRESETS, createEmptyDocument, type PageSize } from "../types";
import { IconFile } from "../icons";
import { PRODUCT } from "@/lib/product-copy";

function categoryAnchorId(categoryId: TemplateCategory) {
  return `picker-cat-${categoryId}`;
}

function asTemplateCategory(value: string | null | undefined): TemplateCategory | null {
  if (!value) return null;
  return TEMPLATE_CATEGORIES.some((cat) => cat.id === value) ? (value as TemplateCategory) : null;
}

export default function TemplatePicker({ onPicked }: { onPicked?: (name: string) => void }) {
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const close = () => useEditorStore.getState().setShowTemplatePicker(false);
  const [step, setStep] = useState<"grid" | "size">("grid");
  const [customW, setCustomW] = useState(850);
  const [customH, setCustomH] = useState(1100);
  const modalRef = useRef<HTMLDivElement>(null);
  const clickingRef = useRef(false);

  const populatedCategories = useMemo(
    () => TEMPLATE_CATEGORIES.filter((cat) => TEMPLATES.some((t) => t.category === cat.id)),
    [],
  );
  const [activeCategory, setActiveCategory] = useState<TemplateCategory | "">(
    populatedCategories[0]?.id ?? "",
  );

  useEffect(() => {
    if (step !== "grid") return;
    const root = modalRef.current;
    if (!root) return;
    const nodes = populatedCategories
      .map((cat) => root.querySelector(`#${CSS.escape(categoryAnchorId(cat.id))}`))
      .filter((node): node is HTMLElement => node instanceof HTMLElement);
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
        root,
        rootMargin: "-72px 0px -55% 0px",
        threshold: [0.1, 0.25, 0.5],
      },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [populatedCategories, step]);

  function scrollToCategory(categoryId: TemplateCategory) {
    const root = modalRef.current;
    const target = root?.querySelector(`#${CSS.escape(categoryAnchorId(categoryId))}`);
    if (!(target instanceof HTMLElement) || !root) return;
    clickingRef.current = true;
    setActiveCategory(categoryId);
    const top = target.offsetTop - 64;
    root.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
    window.setTimeout(() => {
      clickingRef.current = false;
    }, 700);
  }

  function startBlank(size: PageSize) {
    loadDocument(createEmptyDocument(size));
    onPicked?.(PRODUCT.untitledDesign);
    close();
  }

  function pickTemplate(label: string, build: () => ReturnType<typeof createEmptyDocument>) {
    loadDocument(build());
    onPicked?.(`${label} copy`);
    close();
  }

  function TemplateCard({ t }: { t: Template }) {
    return (
      <button type="button" className="template-card" onClick={() => pickTemplate(t.label, t.build)}>
        <div className={`template-thumb thumb-${t.id}`}>
          <div className="thumb-line thumb-title" />
          <div className="thumb-line" />
          <div className="thumb-line short" />
          <div className="thumb-line" />
        </div>
        <span className="template-name">{t.label}</span>
        <span className="template-desc">{t.description}</span>
      </button>
    );
  }

  if (step === "size") {
    return (
      <div className="template-overlay" onPointerDown={(e) => e.target === e.currentTarget && close()}>
        <div className="template-modal">
          <button type="button" className="template-close" title="Cancel" onClick={close}>
            ×
          </button>
          <h2>Choose a page size</h2>
          <p>You can change this later from the Page panel.</p>
          <div className="template-grid size-grid">
            {PAGE_SIZE_PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.id}
                className="template-card"
                onClick={() => startBlank(preset.size)}
              >
                <div
                  className="size-thumb"
                  style={{ aspectRatio: `${preset.size.w} / ${preset.size.h}` }}
                />
                <span className="template-name">{preset.label}</span>
                <span className="template-desc">
                  {preset.size.w} × {preset.size.h}px
                </span>
              </button>
            ))}
          </div>
          <div className="custom-size-row">
            <span className="custom-size-label">Custom:</span>
            <input
              type="number"
              value={customW}
              onChange={(e) => setCustomW(Number(e.target.value))}
            />
            <span>×</span>
            <input
              type="number"
              value={customH}
              onChange={(e) => setCustomH(Number(e.target.value))}
            />
            <button
              type="button"
              className="chip-btn"
              onClick={() => startBlank({ w: Math.max(100, customW), h: Math.max(100, customH) })}
            >
              Use custom size
            </button>
          </div>
          <button type="button" className="template-back" onClick={() => setStep("grid")}>
            ◀ {PRODUCT.backToDesigns}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="template-overlay" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div ref={modalRef} className="template-modal template-modal-wide">
        <button type="button" className="template-close" title="Cancel" onClick={close}>
          ×
        </button>
        <h2>{PRODUCT.whatToCreate}</h2>
        <p>Pick a starter design to produce, then refine it. Or start blank.</p>

        <nav className="template-category-index" aria-label="Design categories">
          <div className="template-category-index-row">
            {populatedCategories.map((cat) => {
              const active = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  className={active ? "template-cat-chip is-active" : "template-cat-chip"}
                  aria-current={active ? "true" : undefined}
                  onClick={() => scrollToCategory(cat.id)}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>
        </nav>

        <button type="button" className="template-card template-card-blank" onClick={() => setStep("size")}>
          <div className="template-thumb blank">
            <IconFile />
          </div>
          <span className="template-name">{PRODUCT.blankPage}</span>
          <span className="template-desc">Choose a page size to start with</span>
        </button>

        {populatedCategories.map((cat) => {
          const items = TEMPLATES.filter((t) => t.category === cat.id);
          return (
            <section
              key={cat.id}
              id={categoryAnchorId(cat.id)}
              data-category-id={cat.id}
              className="template-category"
            >
              <div className="template-category-head">
                <h3>{cat.label}</h3>
                <p>{cat.blurb}</p>
              </div>
              <div className="template-grid">
                {items.map((t) => (
                  <TemplateCard key={t.id} t={t} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
