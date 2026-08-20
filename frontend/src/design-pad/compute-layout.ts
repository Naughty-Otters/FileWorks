import type { DesignNode } from "./types";
import { arrange, resolveAutoSize } from "./layout/arrange";

/** Sync JS stand-in for design_pad's Rust/WASM solver. Same arrange +
 * hug-contents behavior the editor relies on for auto-layout boxes. */
export async function computeLayout(root: DesignNode): Promise<DesignNode> {
  const clone = structuredClone(root);
  resolveAutoSize(clone);
  arrange(clone);
  return clone;
}
