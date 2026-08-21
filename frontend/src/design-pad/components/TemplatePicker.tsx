"use client";

import { useState } from "react";
import { useEditorStore } from "../store";
import { TEMPLATES, TEMPLATE_CATEGORIES, type Template } from "../templates";
import { PAGE_SIZE_PRESETS, createEmptyDocument, type PageSize } from "../types";
import { IconFile } from "../icons";
import { PRODUCT } from "@/lib/product-copy";

export default function TemplatePicker({ onPicked }: { onPicked?: (name: string) => void }) {
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const close = () => useEditorStore.getState().setShowTemplatePicker(false);
  const [step, setStep] = useState<"grid" | "size">("grid");
  const [customW, setCustomW] = useState(850);
  const [customH, setCustomH] = useState(1100);

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
      <button
        type="button"
        className="template-card"
        onClick={() => pickTemplate(t.label, t.build)}
      >
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
      <div className="template-modal template-modal-wide">
        <button type="button" className="template-close" title="Cancel" onClick={close}>
          ×
        </button>
        <h2>{PRODUCT.whatToCreate}</h2>
        <p>Pick a starter design to produce, then refine it. Or start blank.</p>

        <button type="button" className="template-card template-card-blank" onClick={() => setStep("size")}>
          <div className="template-thumb blank">
            <IconFile />
          </div>
          <span className="template-name">{PRODUCT.blankPage}</span>
          <span className="template-desc">Choose a page size to start with</span>
        </button>

        {TEMPLATE_CATEGORIES.map((cat) => {
          const items = TEMPLATES.filter((t) => t.category === cat.id);
          if (!items.length) return null;
          return (
            <section key={cat.id} className="template-category">
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
