---
description: Check fileworks.ai's live SEO health and on-page code, fix what's fixable, and report the rest.
---

Run a full SEO health check for fileworks.ai, covering both the deployed site and the frontend source, then fix whatever is a safe, on-page/code-level fix. Do not commit, push, or deploy — leave any fixes in the working tree for manual review, and end by telling the user what changed and what's left to commit.

## 1. Live site checks (read-only — use Bash/curl, WebSearch)

- `curl -A "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"` the homepage and every path in `frontend/src/lib/seo.ts`'s `INDEXABLE_ROUTES` (pricing, docs, templates, edit, about, legal, and each `CONVERT_GUIDES` path). For each, check:
  - HTTP 200 (no accidental redirect/404/5xx)
  - a `<title>` containing a real keyword, not just the brand name
  - `<meta name="description">` present and non-generic
  - exactly one `<h1>` and it is NOT just the site logo/brand name alone
  - `<link rel="canonical">` present and self-referential (or intentionally pointing elsewhere)
  - no accidental `<meta name="robots" content="noindex">` on a page that should be indexed
- `curl` `/robots.txt` and `/sitemap.xml` — confirm both are HTTP 200, the sitemap lists exactly the routes in `INDEXABLE_ROUTES`, and robots.txt disallows only `/profile`, `/login`, `/admin`, `/templates/new`.
- `WebSearch` `site:fileworks.ai` — note which URLs are indexed vs. the full `INDEXABLE_ROUTES` list, and flag any that have been live 2+ weeks but still aren't indexed.
- `WebSearch` a couple of primary keywords from `PRIMARY_KEYWORDS` (e.g. "PDF to Markdown converter online") — note fileworks.ai's position if it appears, or that it doesn't.

## 2. Source checks (read the code, don't just trust prior fixes stayed in place)

- Every route under `frontend/src/app/**/page.tsx` that isn't noindex exports a `Metadata` with a title, description, and canonical path (via `buildPageMetadata`).
- No component renders `<BrandLockup asHeading />` outside of a context where it's genuinely the page's only/primary heading (grep for `asHeading`).
- `grep -rn "<h1"` across `src/components` and `src/app` — flag any page with zero or more-than-one real content `<h1>`.
- `frontend/src/lib/seo.ts`'s `INDEXABLE_ROUTES` includes every public marketing/guide page and excludes `/profile`, `/login`, `/admin`.
- `HOME_FAQS`, `TEMPLATE_FAQS`, `PRICING_FAQS`, and each guide's `faqs` are actually rendered via `<SeoFaq>` somewhere reachable from their intended page (not orphaned).
- `frontend/src/app/sitemap.ts`'s `lastModified` is still build-time (`new Date()`), not a hardcoded past date.
- Run `cd frontend && npx tsc --noEmit`, `npx eslint <changed files>`, and `npx vitest run` after any fix — a fix that breaks a test or type isn't done.

## 3. Fix what's safe to fix automatically

In scope to fix directly: missing/weak `<title>`/description, wrong heading hierarchy, an FAQ block that exists in `seo.ts` but isn't rendered anywhere, a stale sitemap date, a route missing from `INDEXABLE_ROUTES`, broken/dead internal links.

Out of scope — report these but don't act on them: anything requiring a backlink/content strategy, Search Console access, actual deploy/push, or a redesign of the interactive `Workspace` app shell.

## 4. Compare, then fix again if SEO did not improve

Read the previous snapshot at `.cursor/seo-check-last.md` when it exists. Treat SEO as improved only when a previously failing in-scope check now passes, or a previously missing indexed URL from `INDEXABLE_ROUTES` now appears. Rankings and backlinks alone are not an in-scope improvement.

If SEO did not improve:

1. Name the failing check and the concrete reason it failed (status, missing tag, heading, sitemap mismatch, orphaned FAQ, or a live-vs-source gap).
2. Apply another safe in-scope fix aimed at that reason. Do not repeat a fix that the snapshot already records as tried.
3. Re-run sections 1–2 for the affected URLs and source files.
4. Keep that cycle until either every in-scope check passes, or the same failure remains and the only remaining causes are out of scope.

Then overwrite `.cursor/seo-check-last.md` with this run's date, pass/fail per route, indexation notes, fixes applied, and anything still open.

## 5. Report

Summarize: what was checked, what's healthy, what was broken and fixed (with file:line), what's broken but needs a human call, and current indexation/ranking signal vs. the last time this command ran (if you have that context). End with what's uncommitted and ready for the user to review.
