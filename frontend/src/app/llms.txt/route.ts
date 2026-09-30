import { CONVERT_GUIDES, SITE_DESCRIPTION, SITE_TAGLINE, absoluteUrl, BUSINESS_NAME } from "@/lib/seo";

export const dynamic = "force-static";

/**
 * llms.txt (https://llmstxt.org) — a plain-text index for LLM-based crawlers
 * and coding agents, distinct from robots.txt/sitemap.xml which target
 * classic search crawlers. Generated from the same data as the sitemap so it
 * can't drift when a guide is added or removed.
 */
export function GET() {
  const guideLines = CONVERT_GUIDES.map(
    (guide) => `- [${guide.title}](${absoluteUrl(guide.path)}): ${guide.description}`,
  ).join("\n");

  const body = `# ${BUSINESS_NAME}

> ${SITE_TAGLINE}

${SITE_DESCRIPTION}

## Docs
- [Convert API reference](${absoluteUrl("/docs")}): POST /api/v1/convert — curl, Python, and JavaScript examples, AI reading (OCR), translation, and Design auto-fill via \`design=<starter_id>\`.
- [Pricing](${absoluteUrl("/pricing")}): Workspace (Casual/Daily/Expert) and Convert API (Free/Daily/Expert) plans.

## Format guides
${guideLines}

## Optional
- [Document designs](${absoluteUrl("/templates")}): fillable Designs (invoices, receipts, family schedules, agendas, project plans, and more), AI-filled from converted Markdown.
- [About](${absoluteUrl("/about")}): company, legal entity, and supported format list.
`;

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
