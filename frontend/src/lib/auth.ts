const ACCESS_KEY = "fileworks.access_token";
const REFRESH_KEY = "fileworks.refresh_token";
const HINT_KEY = "fileworks.session_hint";

function readStorage(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(store: Storage, key: string, value: string): void {
  try {
    store.setItem(key, value);
  } catch {
    // Private mode / quota — session just will not persist.
  }
}

function removeStorage(store: Storage, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    // ignore
  }
}

export type PlanId = "anonymous" | "basic" | "pro" | "premium";

export type MeResponse = {
  user: {
    id: string;
    email: string;
    name: string | null;
    picture_url: string | null;
    plan: string;
  } | null;
  plan: PlanId | string;
  permissions: Record<string, boolean>;
  quota: {
    used_day: number;
    used_month: number;
    limit_day: number | null;
    limit_month: number | null;
    remaining_day: number | null;
    remaining_month: number | null;
    used_ai_day: number;
    used_ai_month: number;
    limit_ai_day: number | null;
    limit_ai_month: number | null;
    remaining_ai_day: number | null;
    remaining_ai_month: number | null;
  };
  google_client_id: string | null;
  billing?: {
    enabled: boolean;
    prices: Record<string, boolean>;
    amounts?: Record<string, number>;
    currency?: string;
    subscription_status?: string | null;
    cancel_at_period_end?: boolean;
    current_period_end?: string | null;
    api_plan?: string | null;
    api_subscription_status?: string | null;
    api_cancel_at_period_end?: boolean;
    api_current_period_end?: string | null;
    api?: {
      amounts?: Record<string, number>;
      prices?: Record<string, boolean>;
    };
  } | null;
  api_plan?: string;
  api_quota?: {
    used_credits: number;
    limit_credits: number | null;
    remaining_credits: number | null;
  };
};

/**
 * Access + refresh live in localStorage so a new tab on the same origin keeps the
 * signed-in session. (sessionStorage is tab-scoped and used to drop logins.)
 * Older builds kept access in sessionStorage — migrate once if found.
 */
export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  const fromLocal = readStorage(window.localStorage, ACCESS_KEY);
  if (fromLocal) return fromLocal;
  const fromSession = readStorage(window.sessionStorage, ACCESS_KEY);
  if (fromSession) {
    writeStorage(window.localStorage, ACCESS_KEY, fromSession);
    removeStorage(window.sessionStorage, ACCESS_KEY);
    return fromSession;
  }
  return null;
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return readStorage(window.localStorage, REFRESH_KEY);
}

export function setSession(access: string, refresh: string) {
  writeStorage(window.localStorage, ACCESS_KEY, access);
  writeStorage(window.localStorage, REFRESH_KEY, refresh);
  removeStorage(window.sessionStorage, ACCESS_KEY);
}

export function clearSession() {
  removeStorage(window.localStorage, ACCESS_KEY);
  removeStorage(window.localStorage, REFRESH_KEY);
  removeStorage(window.sessionStorage, ACCESS_KEY);
  clearSessionHint();
}

/** A token exists, so this browser is signed in until the API says otherwise. */
export function hasStoredSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(getAccessToken() || getRefreshToken());
  } catch {
    return false;
  }
}

export type SessionUser = NonNullable<MeResponse["user"]>;

/**
 * Last known identity, kept so the header can paint the avatar on the first frame
 * instead of guessing "signed out" while /api/me is in flight. Display only —
 * every request still authorizes with the real token.
 */
export function readSessionHint(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionUser> | null;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.email !== "string") return null;
    return {
      id: parsed.id,
      email: parsed.email,
      name: typeof parsed.name === "string" ? parsed.name : null,
      picture_url: typeof parsed.picture_url === "string" ? parsed.picture_url : null,
      plan: typeof parsed.plan === "string" ? parsed.plan : "basic",
    };
  } catch {
    return null;
  }
}

export function writeSessionHint(user: SessionUser): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HINT_KEY, JSON.stringify(user));
  } catch {
    // Private mode or a full quota: the header just falls back to a placeholder.
  }
}

export function clearSessionHint(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(HINT_KEY);
  } catch {
    // ignore
  }
}

let refreshTimer: number | null = null;

export function scheduleTokenRefresh(refreshFn: () => Promise<void>, ttlMs = 50 * 60 * 1000) {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    void refreshFn();
  }, ttlMs);
}
