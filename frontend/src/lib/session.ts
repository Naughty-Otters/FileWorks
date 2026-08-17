"use client";

import { useEffect, useSyncExternalStore } from "react";
import { ApiError, fetchMe, refreshSession } from "@/lib/api";
import {
  clearSessionHint,
  getAccessToken,
  getRefreshToken,
  hasStoredSession,
  readSessionHint,
  scheduleTokenRefresh,
  writeSessionHint,
  type MeResponse,
  type SessionUser,
} from "@/lib/auth";

/**
 * "unknown" only exists before the store reads local storage. The header must not
 * render "Sign in" while unknown: guessing wrong is what makes a refresh flash.
 */
export type SessionStatus = "unknown" | "signed-in" | "guest";

export type SessionState = {
  status: SessionStatus;
  /** Server truth. Null until /api/me answers, so permissions are never assumed. */
  me: MeResponse | null;
  /** Cached identity for chrome that should paint immediately. */
  hint: SessionUser | null;
};

const INITIAL: SessionState = { status: "unknown", me: null, hint: null };

let state: SessionState = INITIAL;
let listeners = new Set<() => void>();
let hydrated = false;
let inFlight: Promise<MeResponse> | null = null;
let loadStarted = false;
let refreshScheduled = false;
// Newest-wins ordering: a background load that started before a mutation must not
// overwrite the mutation's fresher answer just because it resolved later.
let issued = 0;
let applied = 0;

function emit(next: SessionState) {
  state = next;
  for (const listener of listeners) listener();
}

/**
 * Local-storage read only, so it can run during the first render. Assigns without
 * notifying: this derives the initial snapshot rather than updating it.
 */
function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  const hint = readSessionHint();
  if (!hasStoredSession()) {
    if (hint) clearSessionHint();
    state = { status: "guest", me: null, hint: null };
    return;
  }
  state = { status: "signed-in", me: null, hint };
}

function applyMe(me: MeResponse, seq: number) {
  if (seq < applied) return;
  applied = seq;
  if (me.user) {
    writeSessionHint(me.user);
    emit({ status: "signed-in", me, hint: me.user });
    return;
  }
  clearSessionHint();
  emit({ status: "guest", me, hint: null });
}

function applyError(err: unknown) {
  // Only a rejected credential means signed out. A network blip keeps the
  // optimistic avatar rather than bouncing the user to a "Sign in" header.
  if (err instanceof ApiError && err.status === 401) {
    applied = ++issued;
    clearSessionHint();
    emit({ status: "guest", me: null, hint: null });
  }
}

/**
 * Fetch and publish the session. Shared and deduped, so five components mounting
 * at once still make one request. Stable module function, safe in effect bodies.
 *
 * `/api/me` returns an anonymous principal (200) when no access token is sent, so
 * a tab that only has a refresh token must refresh first — otherwise we would
 * incorrectly treat a signed-in browser as a guest.
 */
export function reloadSession(): Promise<MeResponse> {
  hydrate();
  if (!inFlight) {
    const seq = ++issued;
    inFlight = (async () => {
      if (getRefreshToken() && !getAccessToken()) {
        await refreshSession().catch(() => false);
      }
      let me = await fetchMe();
      if (!me.user && getRefreshToken()) {
        if (await refreshSession()) {
          me = await fetchMe();
        }
      }
      applyMe(me, seq);
      return me;
    })()
      .catch((err) => {
        applyError(err);
        throw err;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

function startSession() {
  if (loadStarted) return;
  loadStarted = true;
  void reloadSession().catch(() => undefined);
  if (refreshScheduled) return;
  refreshScheduled = true;
  scheduleTokenRefresh(async () => {
    if (await refreshSession()) await reloadSession().catch(() => undefined);
  });
}

/** Publish a MeResponse already returned by a mutation (plan change, billing sync). */
export function setSessionMe(me: MeResponse): void {
  hydrate();
  applyMe(me, ++issued);
}

/** Publish the signed-out state, e.g. straight after logoutSession(). */
export function clearSessionState(): void {
  hydrated = true;
  applied = ++issued;
  clearSessionHint();
  emit({ status: "guest", me: null, hint: null });
}

export function getSessionState(): SessionState {
  hydrate();
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): SessionState {
  return INITIAL;
}

/** Test-only: module state outlives a single render tree. */
export function resetSessionStore(): void {
  state = INITIAL;
  listeners = new Set();
  hydrated = false;
  inFlight = null;
  loadStarted = false;
  refreshScheduled = false;
  issued = 0;
  applied = 0;
}

export type UseSessionResult = SessionState & {
  /** The identity to display: server truth when known, cached hint otherwise. */
  displayUser: SessionUser | null;
};

/**
 * Read the shared session. Mutating it is done with the module functions
 * `reloadSession` and `setSessionMe`, which are stable and need no effect deps.
 */
export function useSession(): UseSessionResult {
  const snapshot = useSyncExternalStore(subscribe, getSessionState, getServerSnapshot);

  useEffect(() => {
    startSession();
  }, []);

  return { ...snapshot, displayUser: snapshot.me?.user ?? snapshot.hint };
}
