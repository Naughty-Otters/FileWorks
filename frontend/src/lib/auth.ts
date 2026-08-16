const ACCESS_KEY = "fileworks.access_token";
const REFRESH_KEY = "fileworks.refresh_token";

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

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function setSession(access: string, refresh: string) {
  sessionStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}

export function clearSession() {
  sessionStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

let refreshTimer: number | null = null;

export function scheduleTokenRefresh(refreshFn: () => Promise<void>, ttlMs = 50 * 60 * 1000) {
  if (refreshTimer) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    void refreshFn();
  }, ttlMs);
}
