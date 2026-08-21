/**
 * User-facing product language for fillable document layouts.
 * Prefer these strings over "template" in UI and marketing copy.
 * API routes and code identifiers may still say template.
 */
export const PRODUCT = {
  /** Nav / footer label */
  designs: "Designs",
  /** Singular */
  design: "Design",
  /** Library page H1 */
  documentDesigns: "Document designs",
  /** Studio eyebrow */
  studio: "Design studio",
  /** Built-in catalog section */
  starterDesigns: "Starter designs",
  starterDesign: "Starter design",
  /** User-saved section */
  yourDesigns: "Your designs",
  myDesign: "My design",
  /** Convert dialog title */
  produceAs: "Produce as",
  /** Convert target tooltip */
  chooseTarget: "Choose Markdown or a Design to fill",
  /** Picker prompt */
  whatToCreate: "What do you want to create?",
  backToDesigns: "Back to designs",
  /** Empty / untitled */
  untitledDesign: "Untitled design",
  newDesign: "New design",
  blankPage: "Blank page",
  savedDesign: "Saved design",
  /** Footer / guide link */
  fillableDesigns: "Fillable document designs",
  /** Field declarations in the editor */
  placeholders: "Placeholders",
  /** One-liner for marketing */
  oneLiner:
    "Convert any file into Markdown, then produce a finished Design — invoices, family schedules, agendas, and more — filled from that content.",
} as const;
