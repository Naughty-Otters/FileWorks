const USER_ID_KEY = "fileworks.user_id";

/** Stable anonymous id until real auth exists. Used as S3 prefix user_id. */
export function getClientUserId(): string {
  if (typeof window === "undefined") return "anonymous";
  try {
    const existing = window.localStorage.getItem(USER_ID_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const id = crypto.randomUUID().replace(/-/g, "");
    window.localStorage.setItem(USER_ID_KEY, id);
    return id;
  } catch {
    return "anonymous";
  }
}
