"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BrandLockup } from "@/components/brand-lockup";
import { MarketingNav } from "@/components/marketing-nav";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  fetchAdminOverview,
  fetchAdminPlans,
  fetchAdminUser,
  fetchAdminUsers,
  updateAdminUser,
  type AdminOverview,
  type AdminPlanOptions,
  type AdminUserDetail,
  type AdminUserSummary,
} from "@/lib/api";
import { planDisplayLabel, apiPlanDisplayLabel } from "@/lib/plans";
import { reloadSession, useSession } from "@/lib/session";

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function AdminPage() {
  const { me, displayUser } = useSession();
  const [ready, setReady] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [plans, setPlans] = useState<AdminPlanOptions | null>(null);
  const [users, setUsers] = useState<AdminUserSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [pending, setPending] = useState(false);
  const [draftPlan, setDraftPlan] = useState("basic");
  const [draftApiPlan, setDraftApiPlan] = useState("api_free");

  const loadList = useCallback(async (q: string) => {
    const list = await fetchAdminUsers({ q: q || undefined, limit: 100 });
    setUsers(list.items);
    setTotal(list.total);
  }, []);

  useEffect(() => {
    void reloadSession()
      .then(async (session) => {
        if (!session.user) {
          window.location.assign("/login?next=/admin");
          return;
        }
        if (!session.is_admin) {
          setForbidden(true);
          setReady(true);
          return;
        }
        try {
          const [over, planOpts] = await Promise.all([fetchAdminOverview(), fetchAdminPlans()]);
          setOverview(over);
          setPlans(planOpts);
          await loadList("");
          setReady(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Admin load failed");
          setReady(true);
        }
      })
      .catch(() => window.location.assign("/login?next=/admin"));
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void fetchAdminUser(selectedId)
      .then((row) => {
        if (cancelled) return;
        setDetail(row);
        setDraftPlan(row.plan);
        setDraftApiPlan(row.api_plan);
        setNotice(null);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load user");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(query.trim());
    setError(null);
    try {
      await loadList(query.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    }
  }

  async function onSavePlans() {
    if (!detail) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await updateAdminUser(detail.id, {
        plan: draftPlan,
        api_plan: draftApiPlan,
      });
      setDetail(updated);
      setNotice("Plans updated.");
      await loadList(search);
      if (overview) {
        setOverview(await fetchAdminOverview());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setPending(false);
    }
  }

  if (!ready) {
    const who = displayUser?.name || displayUser?.email;
    return (
      <div className="app-shell relative">
        <div className="atmosphere" aria-hidden />
        <p className="relative z-10 p-8 text-sm text-[var(--ink-muted)]">
          {who ? `Loading admin for ${who}…` : "Loading admin…"}
        </p>
      </div>
    );
  }

  if (forbidden || !me?.is_admin) {
    return (
      <div className="app-shell relative">
        <div className="atmosphere" aria-hidden />
        <main className="relative z-10 mx-auto max-w-lg px-4 py-16">
          <p className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Admin</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">You do not have admin access.</p>
          <a href="/profile" className="mt-6 inline-block text-sm text-[var(--accent-strong)] hover:underline">
            Back to account
          </a>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell relative">
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <BrandLockup />
          <MarketingNav>
            <ThemeToggle className="h-8 w-8" />
          </MarketingNav>
        </div>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8 md:px-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--accent-strong)]">Admin</p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl tracking-tight">Database</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Inspect users and override workspace / API plans. Access is limited to kenny.zlee@gmail.com.
          </p>
        </div>

        {overview ? (
          <section className="panel grid gap-3 rounded-3xl px-5 py-5 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Users" value={overview.users} />
            <Stat label="Usage events" value={overview.usage_events} />
            <Stat label="API keys" value={overview.api_keys} />
            <Stat label="History docs" value={overview.history_documents} />
            <Stat label="Templates" value={overview.templates} />
          </section>
        ) : null}

        {overview ? (
          <section className="grid gap-4 md:grid-cols-2">
            <div className="panel rounded-3xl px-5 py-5">
              <h2 className="text-sm font-semibold">Workspace plans</h2>
              <ul className="mt-3 space-y-1 text-sm text-[var(--ink-muted)]">
                {Object.entries(overview.plans).map(([id, count]) => (
                  <li key={id} className="flex justify-between gap-3">
                    <span>{planDisplayLabel(id)}</span>
                    <span>{count}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel rounded-3xl px-5 py-5">
              <h2 className="text-sm font-semibold">API plans</h2>
              <ul className="mt-3 space-y-1 text-sm text-[var(--ink-muted)]">
                {Object.entries(overview.api_plans).map(([id, count]) => (
                  <li key={id} className="flex justify-between gap-3">
                    <span>{apiPlanDisplayLabel(id)}</span>
                    <span>{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
          <div className="panel rounded-3xl px-5 py-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Users</h2>
                <p className="text-xs text-[var(--ink-muted)]">{total} total</p>
              </div>
              <form onSubmit={onSearch} className="flex gap-2">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search email or name"
                  className="min-w-[12rem] rounded-full border border-[var(--line)] bg-transparent px-3 py-1.5 text-sm"
                />
                <button
                  type="submit"
                  className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white dark:text-[#06281d]"
                >
                  Search
                </button>
              </form>
            </div>
            <div className="mt-4 max-h-[28rem] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-[var(--bg-panel)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                  <tr>
                    <th className="py-2 pr-2 font-medium">Email</th>
                    <th className="py-2 pr-2 font-medium">Plan</th>
                    <th className="py-2 pr-2 font-medium">API</th>
                    <th className="py-2 font-medium">Usage</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((row) => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer border-t border-[var(--line)] ${
                        selectedId === row.id ? "bg-[var(--accent-soft)]" : "hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
                      }`}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <td className="py-2 pr-2">
                        <div className="truncate font-medium">{row.email}</div>
                        <div className="truncate text-xs text-[var(--ink-muted)]">{row.name || "—"}</div>
                      </td>
                      <td className="py-2 pr-2">{planDisplayLabel(row.plan)}</td>
                      <td className="py-2 pr-2">{apiPlanDisplayLabel(row.api_plan)}</td>
                      <td className="py-2 text-[var(--ink-muted)]">{row.usage_events}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!users.length ? (
                <p className="mt-4 text-sm text-[var(--ink-muted)]">No users match.</p>
              ) : null}
            </div>
          </div>

          <div className="panel rounded-3xl px-5 py-5">
            <h2 className="text-sm font-semibold">User detail</h2>
            {!detail ? (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">Select a user to inspect and edit plans.</p>
            ) : (
              <div className="mt-4 space-y-4">
                <div>
                  <p className="font-[family-name:var(--font-display)] text-xl tracking-tight">
                    {detail.name || detail.email}
                  </p>
                  <p className="text-sm text-[var(--ink-muted)]">{detail.email}</p>
                </div>
                <dl className="grid gap-2 text-sm">
                  <Row label="ID" value={detail.id} mono />
                  <Row label="Google sub" value={detail.google_sub || "—"} mono />
                  <Row label="Created" value={formatWhen(detail.created_at)} />
                  <Row label="Updated" value={formatWhen(detail.updated_at)} />
                  <Row label="Stripe customer" value={detail.stripe_customer_id || "—"} mono />
                  <Row label="Workspace sub" value={detail.stripe_subscription_id || "—"} mono />
                  <Row label="API sub" value={detail.stripe_api_subscription_id || "—"} mono />
                  <Row
                    label="Counts"
                    value={`${detail.usage_events} usage · ${detail.api_keys} keys · ${detail.history_documents} history · ${detail.templates} templates`}
                  />
                </dl>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                      Workspace plan
                    </span>
                    <select
                      value={draftPlan}
                      onChange={(e) => setDraftPlan(e.target.value)}
                      className="w-full rounded-xl border border-[var(--line)] bg-transparent px-3 py-2"
                    >
                      {(plans?.workspace_plans || []).map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.label} ({plan.id})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--ink-muted)]">
                      API plan
                    </span>
                    <select
                      value={draftApiPlan}
                      onChange={(e) => setDraftApiPlan(e.target.value)}
                      className="w-full rounded-xl border border-[var(--line)] bg-transparent px-3 py-2"
                    >
                      {(plans?.api_plans || []).map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.label} ({plan.id})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <button
                  type="button"
                  disabled={pending || (draftPlan === detail.plan && draftApiPlan === detail.api_plan)}
                  onClick={() => void onSavePlans()}
                  className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-45 dark:text-[#06281d]"
                >
                  {pending ? "Saving…" : "Save plans"}
                </button>

                {notice ? <p className="text-sm text-[var(--ink-muted)]">{notice}</p> : null}
              </div>
            )}
            {error ? <p className="mt-3 text-sm text-[var(--danger)]">{error}</p> : null}
          </div>
        </section>

        <div className="flex items-center justify-between px-1">
          <a href="/profile" className="text-sm text-[var(--ink-muted)] hover:text-[var(--accent-strong)]">
            Back to account
          </a>
          <a href="/" className="text-sm text-[var(--ink-muted)] hover:text-[var(--accent-strong)]">
            Workspace
          </a>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--ink-muted)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-[var(--ink-muted)]">{label}</dt>
      <dd className={`min-w-0 break-all ${mono ? "font-[family-name:var(--font-mono)] text-xs" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
