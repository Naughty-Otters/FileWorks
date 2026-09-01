/**
 * Runtime API endpoint resolution.
 *
 * `/config.js` is a static file the deploy rewrites from PUBLIC_API_URL or the
 * Terraform `api_url` output, so changing the API host never requires rebuilding
 * the JS bundle. NEXT_PUBLIC_API_URL stays as the build-time fallback for local
 * dev.
 */

export type RuntimeConfig = {
  apiUrl?: string;
  /**
   * Stable origin this deployment should be used on. Cloudflare mints a
   * `<hash>.<project>.pages.dev` host per deploy, and those hosts can never work:
   * Google rejects unregistered JavaScript origins and offers no wildcard.
   */
  canonicalOrigin?: string;
};

declare global {
  interface Window {
    __FILEWORKS_CONFIG__?: RuntimeConfig;
  }
}

const LOCAL_FALLBACK = "http://127.0.0.1:8000";

/** Stable site hosts that proxy /api/* on the same origin (no cross-origin CORS). */
const SAME_ORIGIN_API_HOSTS = new Set([
  "staging.fileworks.ai",
  "fileworks.ai",
  "www.fileworks.ai",
]);

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

/** On the canonical site host, call /api on the same origin — the zone Worker proxies to Lambda. */
function sameOriginApiBase(): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();
  if (!SAME_ORIGIN_API_HOSTS.has(host)) return null;
  return trimSlash(window.location.origin);
}

export function resolveApiBase(): string {
  if (typeof window !== "undefined") {
    // Prefer deploy-written config.js. Do not force same-origin when config still
    // points at api.* — that zone route may not exist until `fw frontend` publishes it.
    const injected = window.__FILEWORKS_CONFIG__?.apiUrl;
    if (typeof injected === "string" && injected.trim()) {
      return trimSlash(injected.trim());
    }
    const onCanonical = sameOriginApiBase();
    if (onCanonical) return onCanonical;
  }
  const fromBuild = process.env.NEXT_PUBLIC_API_URL;
  if (fromBuild && fromBuild.trim()) return trimSlash(fromBuild.trim());
  return LOCAL_FALLBACK;
}

export function resolveCanonicalOrigin(): string {
  if (typeof window === "undefined") return "";
  const configured = window.__FILEWORKS_CONFIG__?.canonicalOrigin;
  return typeof configured === "string" ? trimSlash(configured.trim()) : "";
}

/**
 * Target to send off-canonical hosts to, or "" to stay put.
 * Redirects Cloudflare Pages preview hosts (*.pages.dev) and the www alias of
 * the configured origin. Localhost and other custom domains are never moved.
 */
export function canonicalRedirectTarget(loc: Location = window.location): string {
  const canonical = resolveCanonicalOrigin();
  if (!canonical) return "";
  if (loc.origin === canonical) return "";

  let canonicalHost = "";
  try {
    canonicalHost = new URL(canonical).hostname;
  } catch {
    return "";
  }

  const isPreview = loc.hostname.endsWith(".pages.dev");
  const isWwwAlias = Boolean(canonicalHost) && loc.hostname === `www.${canonicalHost}`;
  if (!isPreview && !isWwwAlias) return "";

  return `${canonical}${loc.pathname}${loc.search}${loc.hash}`;
}
