import { canonicalRedirectTarget, resolveApiBase } from "@/lib/runtime-config";
import { getApiBase } from "@/lib/api";

function loc(href: string): Location {
  return new URL(href) as unknown as Location;
}

describe("runtime api endpoint", () => {
  afterEach(() => {
    delete window.__FILEWORKS_CONFIG__;
  });

  it("prefers the deploy-written config over the build-time fallback", () => {
    window.__FILEWORKS_CONFIG__ = { apiUrl: "https://abc.lambda-url.us-east-1.on.aws" };
    expect(resolveApiBase()).toBe("https://abc.lambda-url.us-east-1.on.aws");
    expect(getApiBase()).toBe("https://abc.lambda-url.us-east-1.on.aws");
  });

  it("drops a trailing slash so paths never double up", () => {
    window.__FILEWORKS_CONFIG__ = { apiUrl: "https://api.example.com/" };
    expect(resolveApiBase()).toBe("https://api.example.com");
  });

  it("falls back when config.js is absent or blank", () => {
    expect(resolveApiBase()).toBe("http://127.0.0.1:8000");
    window.__FILEWORKS_CONFIG__ = { apiUrl: "   " };
    expect(resolveApiBase()).toBe("http://127.0.0.1:8000");
  });

  it("picks up an endpoint change without a rebuild", () => {
    window.__FILEWORKS_CONFIG__ = { apiUrl: "https://old.on.aws" };
    expect(getApiBase()).toBe("https://old.on.aws");
    window.__FILEWORKS_CONFIG__ = { apiUrl: "https://new.on.aws" };
    expect(getApiBase()).toBe("https://new.on.aws");
  });
});

describe("canonical origin redirect", () => {
  const canonical = "https://fileworks-staging.pages.dev";

  afterEach(() => {
    delete window.__FILEWORKS_CONFIG__;
  });

  it("sends a preview host to the stable origin, keeping the path", () => {
    window.__FILEWORKS_CONFIG__ = { canonicalOrigin: canonical };
    expect(canonicalRedirectTarget(loc("https://ba01f4ba.fileworks-staging.pages.dev/login?next=/"))).toBe(
      `${canonical}/login?next=/`,
    );
  });

  it("stays put on the stable origin", () => {
    window.__FILEWORKS_CONFIG__ = { canonicalOrigin: canonical };
    expect(canonicalRedirectTarget(loc(`${canonical}/login`))).toBe("");
  });

  it("never redirects localhost or unrelated custom domains", () => {
    window.__FILEWORKS_CONFIG__ = { canonicalOrigin: canonical };
    expect(canonicalRedirectTarget(loc("http://localhost:3000/"))).toBe("");
    expect(canonicalRedirectTarget(loc("https://app.fileworks.ai/"))).toBe("");
  });

  it("sends the www alias of the canonical host to the apex", () => {
    window.__FILEWORKS_CONFIG__ = { canonicalOrigin: "https://fileworks.ai" };
    expect(canonicalRedirectTarget(loc("https://www.fileworks.ai/login?next=/"))).toBe(
      "https://fileworks.ai/login?next=/",
    );
  });

  it("does not treat www of a different host as the alias", () => {
    window.__FILEWORKS_CONFIG__ = { canonicalOrigin: "https://fileworks.ai" };
    expect(canonicalRedirectTarget(loc("https://www.example.com/"))).toBe("");
  });

  it("is inert when no canonical origin is configured", () => {
    expect(canonicalRedirectTarget(loc("https://ba01f4ba.fileworks-staging.pages.dev/"))).toBe("");
  });
});
