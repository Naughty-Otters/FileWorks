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
  /** Default produce target (Markdown conversion) — a Design, not a separate product */
  defaultDesignName: "Markdown",
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
  chooseTarget: "Choose a Design to fill",
  /** Target pane / picker */
  chooseDesign: "Choose a Design",
  changeDesign: "Change Design",
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
  /** Home / workspace promise — edit or produce */
  homeLine: "Drop a file. Edit the page, or produce a Design.",
  /** Short support under the home promise */
  homeSupport: "Fix text where it sits, or turn the file into something new.",
  /** Path chooser prompt after a file lands */
  whatNext: "What do you want to do?",
  /** Edit path */
  editOnPage: "Edit text on the page",
  editOnPageHint: "Click the text. Change it. Save.",
  /** Produce path */
  makeFromFile: "Produce a Design",
  makeFromFileHint:
    "Turn the file into a finished Design — report, invoice, agenda, schedule, and more.",
  /** Non-editor file on the chooser */
  editorPdfImagesOnly: "Editor is for PDFs and images. Produce a Design from this file.",
  /** Drop CTA */
  dropOrChoose: "Drop or choose a file",
  /** Empty source panel in produce workbench */
  sourceEmptyHint: "Choose a Design, then convert.",
  /** Empty target pane before convert */
  targetEmptyHint: "Pick a Design on the right, then Convert.",
  /** Produce-as dialog intro */
  produceAsIntro:
    "Choose a Design to fill from your file — Markdown, starter designs (family schedules, invoices, agendas), or one of your saved designs.",
  /** Page editor at /edit */
  editor: "Editor",
  editorLine: "Open a PDF or image. Click the text. Save.",
  editTextOnPage: "Edit text on the page.",
  /** CTA from Designs library into workspace with Intent set */
  produceFromFile: "Produce from file",
  /** Edit starter in studio */
  editInStudio: "Edit in studio",
  /** Bridge from Editor back to home produce */
  needProduce: "Produce a Design",
  /** One-liner for marketing */
  oneLiner:
    "From any file → edit text on the page, or produce a finished Design — Markdown report, invoices, family schedules, agendas, and more — filled from that content.",
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

/** Empty target headline — default Design is Markdown. */
export function targetEmptyTitle(intentName: string | null): string {
  return intentName ? `You’ll get ${intentName}` : `You’ll get ${PRODUCT.defaultDesignName}`;
}
