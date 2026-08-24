import { describe, expect, it } from "vitest";
import {
  CONVERT_GUIDES,
  absoluteUrl,
  buildPageMetadata,
  guideBySlug,
  homeJsonLdGraph,
  HOME_FAQS,
  INDEXABLE_ROUTES,
  PRIMARY_KEYWORDS,
  SITE_DESCRIPTION,
  SITE_TAGLINE,
  softwareApplicationJsonLd,
  TEMPLATE_FAQS,
  TEMPLATE_KEYWORDS,
} from "@/lib/seo";

describe("seo helpers", () => {
  it("exposes convert guides for each high-intent format page", () => {
    expect(CONVERT_GUIDES.map((g) => g.slug)).toEqual([
      "pdf-to-markdown",
      "word-to-markdown",
      "excel-to-markdown",
      "powerpoint-to-markdown",
      "image-to-markdown",
    ]);
    expect(guideBySlug("pdf-to-markdown")?.path).toBe("/pdf-to-markdown");
  });

  it("builds absolute canonical URLs and absolute titles", () => {
    const meta = buildPageMetadata({
      title: "PDF to Markdown converter",
      description: "Convert PDF to Markdown online.",
      path: "/pdf-to-markdown",
    });
    expect(meta.alternates?.canonical).toBe(absoluteUrl("/pdf-to-markdown"));
    expect(meta.title).toEqual({ absolute: "PDF to Markdown converter — FileWorks" });
    expect(meta.openGraph?.url).toBe(absoluteUrl("/pdf-to-markdown"));
  });

  it("marks auth pages as noindex", () => {
    const meta = buildPageMetadata({
      title: "Sign in",
      description: "Sign in",
      path: "/login",
      noIndex: true,
    });
    expect(meta.robots).toMatchObject({ index: false, follow: false });
  });

  it("includes homepage structured data entities", () => {
    const graph = homeJsonLdGraph();
    const types = (graph["@graph"] as Array<{ "@type": string }>).map((node) => node["@type"]);
    expect(types).toEqual(expect.arrayContaining(["Organization", "WebSite", "WebApplication"]));
    expect(types).not.toContain("FAQPage");
  });

  it("lists every public marketing route in the sitemap set", () => {
    const paths = INDEXABLE_ROUTES.map((r) => r.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/pricing");
    expect(paths).toContain("/docs");
    expect(paths).toContain("/templates");
    expect(paths).toContain("/about");
    for (const guide of CONVERT_GUIDES) {
      expect(paths).toContain(guide.path);
    }
  });

  it("documents Design-related SEO copy and FAQs", () => {
    expect(SITE_DESCRIPTION.toLowerCase()).toContain("design");
    expect(SITE_TAGLINE.toLowerCase()).toMatch(/produce|file/);
    expect(PRIMARY_KEYWORDS.some((k) => /design/i.test(k))).toBe(true);
    expect(PRIMARY_KEYWORDS.some((k) => /template/i.test(k))).toBe(true); // search alias
    expect(TEMPLATE_KEYWORDS.some((k) => /design/i.test(k))).toBe(true);
    expect(TEMPLATE_KEYWORDS.length).toBeGreaterThan(5);
    expect(TEMPLATE_FAQS.length).toBeGreaterThanOrEqual(3);
    expect(TEMPLATE_FAQS.some((item) => /design/i.test(item.question))).toBe(true);
    expect(HOME_FAQS.some((item) => /design/i.test(`${item.question} ${item.answer}`))).toBe(true);
    const app = softwareApplicationJsonLd();
    expect(app.featureList.some((feature: string) => /design/i.test(feature))).toBe(true);
  });
});
