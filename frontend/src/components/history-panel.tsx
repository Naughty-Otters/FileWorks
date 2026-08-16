"use client";

import { Clock3, FileImage, FileText, PanelLeftClose, PanelLeftOpen, Trash2 } from "lucide-react";
import type { HistoryItem } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";

type HistoryPanelProps = {
  items: HistoryItem[];
  selectedId: string | null;
  loading?: boolean;
  storageBackend?: string | null;
  requiresLogin?: boolean;
  compact?: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onCollapse?: () => void;
  onExpand?: () => void;
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
  storageBackend,
  requiresLogin,
  compact = false,
  onSelect,
  onDelete,
  onCollapse,
  onExpand,
}: HistoryPanelProps) {
  return (
    <aside
      className="panel flex h-full min-h-0 flex-col overflow-hidden rounded-2xl"
      aria-label="History"
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-1 border-b border-[var(--line)] py-2",
          compact ? "flex-col justify-center px-1" : "justify-between px-3",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Clock3 size={15} className="shrink-0 text-[var(--accent)]" />
          {compact ? (
            <h2 className="sr-only">History</h2>
          ) : (
            <h2
              className="font-[family-name:var(--font-display)] text-base tracking-tight"
              title={storageBackend ? `Stored in ${storageBackend}` : undefined}
            >
              History
            </h2>
          )}
        </div>
        {compact
          ? onExpand && (
              <button
                type="button"
                aria-label="Expand history"
                onClick={onExpand}
                className="rounded-full p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
              >
                <PanelLeftOpen size={14} />
              </button>
            )
          : onCollapse && (
              <button
                type="button"
                aria-label="Hide history"
                onClick={onCollapse}
                className="rounded-full p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--accent-strong)]"
              >
                <PanelLeftClose size={14} />
              </button>
            )}
      </div>

      <div className={cn("min-h-0 flex-1 overflow-auto", compact ? "p-1" : "p-2")}>
        {loading && items.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--ink-muted)]">Loading history…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-[var(--ink-muted)]">
            {requiresLogin ? (
              <>
                <a href="/login" className="text-[var(--accent-strong)] underline-offset-2 hover:underline">
                  Sign in
                </a>{" "}
                {compact ? "to save history." : "to save conversions and see history."}
              </>
            ) : compact ? (
              "Convert to save files here."
            ) : (
              "Files you convert will appear here."
            )}
          </p>
        ) : (
          <ul
            className={cn(
              compact ? "flex flex-row gap-1 lg:flex-col" : "space-y-1.5",
            )}
          >
            {items.map((item) => {
              const isPdf =
                item.content_type === "application/pdf" ||
                item.filename.toLowerCase().endsWith(".pdf");
              const selected = selectedId === item.id;
              return (
                <li
                  key={item.id}
                  className={cn(compact && "min-w-[4.5rem] lg:min-w-0")}
                >
                  <div
                    className={cn(
                      "group flex rounded-xl border transition",
                      compact
                        ? "flex-col items-stretch gap-0.5 px-1 py-1.5"
                        : "items-start gap-2 px-2.5 py-2",
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                        : "border-transparent hover:border-[var(--line)] hover:bg-[color-mix(in_oklab,var(--bg-elevated)_70%,transparent)]",
                    )}
                  >
                    <button
                      type="button"
                      title={item.filename}
                      onClick={() => onSelect(item.id)}
                      className={cn(
                        "flex min-w-0 flex-1 text-left",
                        compact ? "flex-col items-center gap-1" : "items-start gap-2",
                      )}
                    >
                      <span className="mt-0.5 text-[var(--accent)]">
                        {isPdf ? <FileText size={14} /> : <FileImage size={14} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            "block truncate font-medium",
                            compact ? "text-center text-[10px] leading-tight" : "text-sm",
                          )}
                        >
                          {item.filename}
                        </span>
                        {compact ? (
                          <span className="mt-0.5 block text-center text-[10px] text-[var(--ink-muted)]">
                            {item.page_count ? `${item.page_count}p` : formatBytes(item.size_bytes)}
                          </span>
                        ) : (
                          <span className="mt-0.5 block text-[11px] text-[var(--ink-muted)]">
                            {formatWhen(item.created_at)} · {formatBytes(item.size_bytes)}
                            {item.page_count ? ` · ${item.page_count}p` : ""}
                          </span>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${item.filename}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(item.id);
                      }}
                      className={cn(
                        "rounded-full p-1.5 text-[var(--ink-muted)] transition hover:bg-[var(--accent-soft)] hover:text-[var(--danger)]",
                        compact
                          ? "self-center opacity-70 lg:opacity-0 lg:group-hover:opacity-100"
                          : "opacity-0 group-hover:opacity-100",
                      )}
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
