# SEO check snapshot

Date: 2026-09-30

## In-scope results

- Live `/` title is still the old tagline and the only `<h1>` is `FileWorks`. Source already serves a keyword title and `<h1>` from `frontend/src/components/home-seo-content.tsx`. Cause: production has not been rebuilt since 2026-08-21 (`sitemap.xml` `<lastmod>`). Not a new source edit.
- Live `/about` title was `About FileWorks` and the `<h1>` was the brand name alone. Source fix: title and `<h1>` are now `About FileWorks — PDF and Office to Markdown` (`frontend/src/app/about/page.tsx`, `frontend/src/components/about-page.tsx`).
- Live `/edit` HTML had zero `<h1>` because the first render is the client loading shell and the empty-state line was a `<p>`. Source fix: loading shell `<h1>` in `frontend/src/components/editor-shell.tsx`; empty-state line is an `<h1>` in `frontend/src/components/page-editor.tsx`.
- Other indexable routes: HTTP 200, keyword titles, descriptions, one `<h1>`, self-canonical, `index, follow`.
- `/robots.txt` disallows only `/profile`, `/login`, `/admin`, `/templates/new`.
- Live sitemap URLs match `INDEXABLE_ROUTES`. Source `lastModified` is `new Date()`; the live date is the last deploy.
- `site:fileworks.ai` returned no indexed URLs. Primary query "PDF to Markdown converter online" did not list fileworks.ai.

## Tried

- About heading/title keyword fix.
- `/edit` server-rendered and empty-state `<h1>`.

## Still open (out of scope until a deploy)

- Republish so live `/`, `/about`, `/edit`, and sitemap `<lastmod>` match source.
- Indexation and rankings need Search Console / time / links, not another on-page edit.
