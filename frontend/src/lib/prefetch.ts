/** Warm async chunks after first paint so Convert → preview does not wait on download. */
export function prefetchHeavyUi() {
  return Promise.all([
    import("@/components/editable-markdown-preview"),
    import("@/components/history-panel"),
    import("@/components/extract-options-panel"),
  ]);
}
