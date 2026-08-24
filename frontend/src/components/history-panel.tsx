"use client";

import { Clock3, FileImage, FileText, PanelLeftClose, Trash2 } from "lucide-react";
import type { HistoryItem } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";

type HistoryPanelProps = {
  items: HistoryItem[];
  selectedId: string | null;
  loading?: boolean;
  disabled?: boolean;
  storageBackend?: string | null;
  requiresLogin?: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCollapse?: () => void;
};

function formatWhen(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function HistoryPanel({
  items,
  selectedId,
  loading,
  disabled,
  storageBackend,
  requiresLogin,
  onSelect,
  onDelete,
  onCollapse,
}: HistoryPanelProps) {
  return (
    <aside
      className={cn(
        "panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl",
        disabled && "pointer-events-none opacity-60",
      )}
      aria-busy={disabled || undefined}
      aria-label="History"
    >
      <div className="flex shrink-0 items-center justify-between gap-1 border-b border-[var(--line)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Clock3 size={15} className="shrink-0 text-[var(--accent)]" />
          <h2
            className="font-[family-name:var(--font-display)] text-base tracking-tight"
            title={storageBackend ? `Stored in ${storageBackend}` : undefined}
          >
            History
          </h2>
        </div>
        {onCollapse ? (
          <button
            type="button"
            aria-label="Hide history"
            onClick={onCollapse}
            className="rounded-full p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
          >
            <PanelLeftClose size={14} />
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        {loading && items.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--ink-muted)]">Loading history…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--ink-muted)]">
            {requiresLogin ? (
              <>
                <a href="/login" className="text-[var(--accent-strong)] underline-offset-2 hover:underline">
                  Sign in
                </a>{" "}
                to save conversions and see history.
              </>
            ) : (
              "Files you convert will appear here."
            )}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((item) => {
              const isPdf =
                item.content_type === "application/pdf" ||
                item.filename.toLowerCase().endsWith(".pdf");
              const selected = selectedId === item.id;
              return (
                <li key={item.id}>
                  <div
                    className={cn(
                      "group flex items-start gap-2 rounded-xl border px-2.5 py-2 transition",
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-transparent hover:border-[var(--line)] hover:bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)]",
                    )}
                  >
                    <button
                      type="button"
                      title={item.filename}
                      disabled={disabled}
                      onClick={() => onSelect(item.id)}
                      className="flex min-w-0 flex-1 items-start gap-2 text-left disabled:cursor-not-allowed"
                    >
                      <span className="mt-0.5 text-[var(--accent)]">
                        {isPdf ? <FileText size={14} /> : <FileImage size={14} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="block truncate text-sm font-medium">{item.filename}</span>
                          {item.has_design ? (
                            <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-strong)]">
                              {item.design_template_name || "Design"}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">
                          {formatWhen(item.created_at)} · {formatBytes(item.size_bytes)}
                          {item.page_count ? ` · ${item.page_count}p` : ""}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${item.filename}`}
                      disabled={disabled}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(item.id);
                      }}
                      className="rounded-full p-1.5 text-[var(--ink-muted)] opacity-0 transition hover:bg-[var(--accent-soft)] hover:text-[var(--danger)] group-hover:opacity-100 disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
