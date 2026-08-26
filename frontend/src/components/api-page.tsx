"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ClipboardCopy } from "lucide-react";
import { BrandLockup } from "@/components/brand-lockup";
import { MarketingNav } from "@/components/marketing-nav";
import { SiteFooter } from "@/components/site-footer";
import { ThemeToggle } from "@/components/theme-toggle";
import { fetchHealth, listApiKeys, type HealthResponse } from "@/lib/api";
import { resolveApiBase } from "@/lib/runtime-config";
import { reloadSession, useSession } from "@/lib/session";
import { SITE_URL, SUPPORT_EMAIL } from "@/lib/legal";
import { organizationJsonLd, softwareApplicationJsonLd } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";

type CodeLang = "bash" | "python" | "javascript";

const KEYWORDS: Record<CodeLang, RegExp> = {
  bash: /\b(?:curl|jq)\b/,
  python: /\b(?:import|from|as|with|open|print|assert|True|False|None|return|def|class)\b/,
  javascript: /\b(?:const|let|var|await|async|fetch|return|true|false|new|console|then|function)\b/,
};

function highlightCode(code: string, lang: CodeLang): ReactNode[] {
  const comment = lang === "javascript" ? /\/\/[^\n]*/ : /(?:^|(?<=\s))#[^\n]*/;
  const tokenRe = new RegExp(
    `(${comment.source}|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\`(?:\\\\.|[^\`\\\\])*\`|${KEYWORDS[lang].source})`,
    "gm",
  );
  const parts = code.split(tokenRe);
  return parts.map((part, index) => {
    if (!part) return <Fragment key={index} />;
    if ((lang === "javascript" && part.startsWith("//")) || (lang !== "javascript" && /^\s*#/.test(part))) {
      return (
        <span key={index} className="tok-cmt">
          {part}
        </span>
      );
    }
    if (/^["'`]/.test(part) && part.length >= 2) {
      return (
        <span key={index} className="tok-str">
          {part}
        </span>
      );
    }
    if (KEYWORDS[lang].test(part)) {
      return (
        <span key={index} className="tok-kw">
          {part}
        </span>
      );
    }
    return <Fragment key={index}>{part}</Fragment>;
  });
}

function CodeBlock({
  lang,
  label,
  code,
}: {
  lang: CodeLang;
  label?: string;
  code: string;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="api-code mt-3">
      <div className="api-code-bar">
        <p className="api-code-meta">
          <span className="api-code-lang">{lang}</span>
          {label ? <span className="api-code-file">{label}</span> : null}
        </p>
        <button
          type="button"
          className="api-code-copy"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={14} /> : <ClipboardCopy size={14} />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{highlightCode(code, lang)}</code>
      </pre>
    </div>
  );
}

function dedicatedApiHost(hostname: string): string {
  if (hostname === "staging.fileworks.ai" || hostname.endsWith(".fileworks-staging.pages.dev")) {
    return "https://api.staging.fileworks.ai";
  }
  if (hostname === "fileworks.ai") {
    return "https://api.fileworks.ai";
  }
  return resolveApiBase();
}

async function probeHealth(base: string): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${base}/api/health`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as HealthResponse;
  } catch {
    return null;
  }
}

export function ApiPage() {
  const [apiBase, setApiBase] = useState("https://api.fileworks.ai");
  const [dedicatedBase, setDedicatedBase] = useState("https://api.fileworks.ai");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const { me } = useSession();
  const [keyHint, setKeyHint] = useState("YOUR_API_KEY");

  useEffect(() => {
    const dedicated = dedicatedApiHost(window.location.hostname);
    setDedicatedBase(dedicated);
    setApiBase(dedicated);
    void (async () => {
      const live = await probeHealth(dedicated);
      if (live) {
        setHealth(live);
        return;
      }
      try {
        setHealth(await fetchHealth());
      } catch {
        setHealth({
          status: "offline",
          app: "FileWorks",
          ocr_ready: false,
          ocr_engine: null,
          ocr_error: "API unreachable",
        });
      }
    })();
    void reloadSession()
      .then(async (session) => {
        if (!session.user) return;
        try {
          const keys = await listApiKeys();
          if (keys[0]) setKeyHint(`${keys[0].prefix}…${keys[0].last4}`);
        } catch {
          // Stay on the placeholder.
        }
      })
      .catch(() => undefined);
  }, []);

  const examples = useMemo(() => {
    const auth = "YOUR_API_KEY";
    return {
      curlFile: `curl -s -H "Authorization: Bearer ${auth}" \\
  -F file=@report.pdf \\
  -F target=markdown \\
  -F download=true \\
  -o report.md \\
  ${apiBase}/api/v1/convert`,
      curlJson: `curl -s -H "Authorization: Bearer ${auth}" \\
  -F file=@report.pdf \\
  -F target=markdown \\
  ${apiBase}/api/v1/convert \\
  | jq -r .markdown`,
      curlDesign: `curl -s -H "Authorization: Bearer ${auth}" \\
  -F file=@invoice-scan.pdf \\
  -F target=html \\
  -F design=invoice \\
  -F design_fill=defaults \\
  -F download=true \\
  -o invoice.html \\
  ${apiBase}/api/v1/convert`,
      python: `import requests
from pathlib import Path

base = "${apiBase}"
headers = {"Authorization": "Bearer ${auth}"}

# Optional: list inputs, targets, and Design starter ids
catalog = requests.get(f"{base}/api/v1/convert", headers=headers).json()
print(catalog["capabilities"], [d["id"] for d in catalog.get("designs", [])])

with open("report.pdf", "rb") as fh:
    res = requests.post(
        f"{base}/api/v1/convert",
        headers=headers,
        files={"file": ("report.pdf", fh, "application/pdf")},
        data={"target": "markdown", "use_ai": "false", "target_lang": "original"},
    )
res.raise_for_status()
Path("report.md").write_text(res.json()["markdown"], encoding="utf-8")`,
      js: `const base = "${apiBase}";
const headers = { Authorization: "Bearer ${auth}" };

const body = new FormData();
body.append("file", fileInput.files[0]);
body.append("target", "markdown");

const res = await fetch(\`\${base}/api/v1/convert\`, { method: "POST", headers, body });
const data = await res.json();
console.log(data.markdown);`,
    };
  }, [apiBase]);

  const apiUp = health?.status === "ok";

  return (
    <div className="app-shell relative">
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            organizationJsonLd(),
            softwareApplicationJsonLd(),
            {
              "@type": "WebPage",
              "@id": `${SITE_URL}/docs`,
              url: `${SITE_URL}/docs`,
              name: "Convert API — FileWorks",
              description:
                "Source + Intent: upload PDF, Word, Excel, PowerPoint, or images to POST /api/v1/convert and receive Markdown or a filled Design via design=.",
              isPartOf: { "@id": `${SITE_URL}/#website` },
            },
          ],
        }}
      />
      <div className="atmosphere" aria-hidden />
      <header className="relative z-10 border-b border-[var(--line)]">
        <div className="mx-auto flex w-full max-w-[1500px] items-center gap-3 px-4 py-2.5 md:px-6">
          <BrandLockup />
          <MarketingNav>
            <ThemeToggle className="h-8 w-8" />
          </MarketingNav>
        </div>
      </header>
      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 md:px-6">
        <div>
          <p className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">Convert API</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-4xl tracking-tight">
            Source + Intent
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Same sentence as the workspace: upload a{" "}
            <span className="font-medium text-[var(--ink)]">file</span> (Source), choose Markdown or
            a Design (Intent). Auth with a <code className="api-inline">fw_live_</code> API key from
            Profile. Accepts PDF, Word, Excel, PowerPoint, images, and text (up to 50 MB).
          </p>
        </div>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">This environment</h2>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-[var(--ink-muted)]">API host</dt>
              <dd>
                <a href={dedicatedBase} className="api-link">
                  {dedicatedBase}
                </a>
              </dd>
            </div>
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-[var(--ink-muted)]">Status</dt>
              <dd className={apiUp ? "text-[var(--accent-strong)]" : "text-[var(--danger)]"}>
                {health ? (apiUp ? "Reachable" : "Unreachable") : "Checking…"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Auth</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Send <code className="api-inline">Authorization: Bearer fw_live_…</code> (or{" "}
            <code className="api-inline">X-Api-Key</code>). Workspace sign-in tokens are not accepted.
            GET convert catalog works without a key; POST convert bills AI page credits only.
          </p>
          {me?.user ? (
            <div className="mt-4">
              <a
                href="/profile"
                className="rounded-full bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white dark:text-[#06281d]"
              >
                Manage API keys
              </a>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                Signed in as {me.user.email} · API {me.api_plan || "api_free"}
                {keyHint !== "YOUR_API_KEY" ? ` · ${keyHint}` : ""}.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm">
              <a href="/login?next=/profile" className="text-[var(--accent-strong)] underline-offset-2 hover:underline">
                Sign in to generate an API key
              </a>
            </p>
          )}
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Convert</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            <code className="api-inline">POST /api/v1/convert</code> — multipart{" "}
            <code className="api-inline">file</code> (Source) plus Intent:{" "}
            <code className="api-inline">target</code> and/or <code className="api-inline">design</code>.
            JSON returns extracted <code className="api-inline">markdown</code> and exported{" "}
            <code className="api-inline">content</code>. Use{" "}
            <code className="api-inline">download=true</code> to receive the file body instead.
          </p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="font-medium text-[var(--ink)]">file</dt>
              <dd className="mt-0.5 text-[var(--ink-muted)]">
                Source document (required). PDF, Office, images, Markdown, TXT, CSV — up to 50 MB.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ink)]">target</dt>
              <dd className="mt-0.5 text-[var(--ink-muted)]">
                Intent output format: <code className="api-inline">markdown</code> (default),{" "}
                <code className="api-inline">txt</code>, <code className="api-inline">html</code>,{" "}
                <code className="api-inline">json</code>, or <code className="api-inline">docx</code>.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ink)]">use_ai</dt>
              <dd className="mt-0.5 text-[var(--ink-muted)]">
                <code className="api-inline">true</code> for OCR on scans and images (1 AI credit /
                page).
              </dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ink)]">target_lang</dt>
              <dd className="mt-0.5 text-[var(--ink-muted)]">
                Translate after reading (e.g. <code className="api-inline">en</code>,{" "}
                <code className="api-inline">zh</code>). Omit or use{" "}
                <code className="api-inline">original</code> to skip.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ink)]">design</dt>
              <dd className="mt-0.5 text-[var(--ink-muted)]">
                Intent Design starter id (<code className="api-inline">invoice</code>,{" "}
                <code className="api-inline">family_daily</code>, …). Fills that Design from the
                extracted Markdown — the API twin of Produce as. List ids on{" "}
                <code className="api-inline">GET /api/v1/convert</code> →{" "}
                <code className="api-inline">designs</code>.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-[var(--ink)]">design_fill</dt>
              <dd className="mt-0.5 text-[var(--ink-muted)]">
                With <code className="api-inline">design</code>:{" "}
                <code className="api-inline">defaults</code> (samples),{" "}
                <code className="api-inline">auto</code> (AI-fill, 1 credit / page), or{" "}
                <code className="api-inline">none</code> plus{" "}
                <code className="api-inline">design_variables</code> JSON.
              </dd>
            </div>
          </dl>
          <p className="mt-4 text-sm leading-6 text-[var(--ink-muted)]">
            <code className="api-inline">GET /api/v1/convert</code> returns the live catalog
            (inputs, targets, languages, Design starters as produce targets, and which options are
            available now).
          </p>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Examples</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Replace YOUR_API_KEY with a key from Profile. Markdown Intent first; Design Intent
            second — same endpoint.
          </p>
          <CodeBlock lang="bash" label="Source → Markdown" code={examples.curlFile} />
          <CodeBlock lang="bash" label="Source → Markdown (JSON)" code={examples.curlJson} />
          <CodeBlock lang="bash" label="Source → Design (invoice)" code={examples.curlDesign} />
          <CodeBlock lang="python" code={examples.python} />
          <CodeBlock lang="javascript" code={examples.js} />
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Quota</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Standard convert is free (monthly page cap). AI reading, translation, or Design{" "}
            <code className="api-inline">design_fill=auto</code> is 1 credit per page. API Free
            includes 1,000 standard pages and 25 AI pages / month. See{" "}
            <a href="/pricing" className="text-[var(--accent-strong)] underline-offset-2 hover:underline">
              Pricing
            </a>
            . Questions:{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="api-link">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
