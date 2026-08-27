import { canOfferEditor } from "@/lib/editor-files";

export type WorkspacePhase = "home" | "choose" | "produce";

/** After history restore — editable types get Edit vs Produce; others go to produce. */
export function phaseForRestoredFile(file: File | null): WorkspacePhase {
  if (file && canOfferEditor(file)) return "choose";
  return "produce";
}

/** Next phase when the user picks or clears a source file. */
export function phaseAfterFileSelect(args: {
  currentPhase: WorkspacePhase;
  outputLayout: string;
  cleared: boolean;
}): WorkspacePhase {
  if (args.cleared) return "home";
  if (args.currentPhase === "produce") return "produce";
  if (args.outputLayout !== "standard") return "produce";
  return "choose";
}
