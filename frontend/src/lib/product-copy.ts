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
  /** Home / workspace promise — Source + Intent */
  homeLine: "Drop a file. Choose what to produce.",
  /** CTA from Designs library into workspace with Intent set */
  produceFromFile: "Produce from file",
  /** Edit starter in studio */
  editInStudio: "Edit in studio",
  /** One-liner for marketing */
  oneLiner:
    "From any file → Markdown or a finished Design — invoices, family schedules, agendas, and more — filled from that content.",
} as const;

/** Primary action label: Convert (Markdown) or Fill {Design}. */
export function produceActionLabel(args: {
  intentName: string | null;
  useAi?: boolean;
}): string {
  if (args.intentName) {
    return args.useAi ? `AI Fill ${args.intentName}` : `Fill ${args.intentName}`;
  }
  return args.useAi ? "AI Convert" : "Convert";
}
