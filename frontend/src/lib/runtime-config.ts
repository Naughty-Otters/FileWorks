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

function trimSlash(value: string): string {
  return value.replace(/\/$/, "");
}

export function resolveApiBase(): string {
  if (typeof window !== "undefined") {
    const injected = window.__FILEWORKS_CONFIG__?.apiUrl;
    if (typeof injected === "string" && injected.trim()) {
      return trimSlash(injected.trim());
    }
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
 * Target to send a preview host to, or "" to stay put. Scoped to *.pages.dev so
 * localhost and custom domains are never redirected.
 */
export function canonicalRedirectTarget(loc: Location = window.location): string {
  const canonical = resolveCanonicalOrigin();
  if (!canonical) return "";
  if (!loc.hostname.endsWith(".pages.dev")) return "";
  if (loc.origin === canonical) return "";
  return `${canonical}${loc.pathname}${loc.search}${loc.hash}`;
}
