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
import { INPUT_FORMATS, OUTPUT_FORMATS, organizationJsonLd, softwareApplicationJsonLd } from "@/lib/seo";
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
      python: `import requests
from pathlib import Path

base = "${apiBase}"
headers = {"Authorization": "Bearer ${auth}"}

catalog = requests.get(f"{base}/api/v1/convert", headers=headers).json()
print(catalog["inputs"], catalog["capabilities"])

with open("report.pdf", "rb") as fh:
    res = requests.post(
        f"{base}/api/v1/convert",
        headers=headers,
        files={"file": ("report.pdf", fh, "application/pdf")},
        data={"target": "markdown", "use_ai": "false", "target_lang": "original"},
    )
res.raise_for_status()
markdown = res.json()["markdown"]
Path("report.md").write_text(markdown, encoding="utf-8")
print(markdown)`,
      js: `const base = "${apiBase}";
const headers = { Authorization: "Bearer ${auth}" };

const catalog = await fetch(\`\${base}/api/v1/convert\`, { headers }).then((r) => r.json());
console.log(catalog.inputs, catalog.capabilities);

const body = new FormData();
body.append("file", fileInput.files[0]);
body.append("target", "markdown");
body.append("use_ai", "false");
body.append("target_lang", "original");

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
                "Upload PDF, Word, Excel, PowerPoint, or images to POST /api/v1/convert and receive Markdown or other exports. Render fillable starter Designs via /api/templates/starters.",
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
            PDF and Office to Markdown API
          </h1>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Upload a PDF, Word, Excel, PowerPoint, image, or text file to{" "}
            <code className="api-inline">POST /api/v1/convert</code>. JSON includes{" "}
            <code className="api-inline">markdown</code> and exported{" "}
            <code className="api-inline">content</code>. Pass{" "}
            <code className="api-inline">download=true</code> to write the converted file
            instead. Create an API key on Profile. Workspace access tokens are not accepted here.
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Inputs: {INPUT_FORMATS.join("; ")}. Targets: {OUTPUT_FORMATS.join(", ")}. Optional{" "}
            <code className="api-inline">use_ai=true</code> for OCR on scans and{" "}
            <code className="api-inline">target_lang</code> for translation. Fillable starter Designs
            (family schedules, invoices, agendas, and more) are available under{" "}
            <code className="api-inline">/api/templates/starters</code>.
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
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-[var(--ink-muted)]">OpenAPI</dt>
              <dd>
                <a href={`${dedicatedBase}/docs`} className="api-link">
                  {dedicatedBase}/docs
                </a>
              </dd>
            </div>
          </dl>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Auth</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Send <code className="api-inline">Authorization: Bearer fw_live_…</code>. A raw
            key in <code className="api-inline">Authorization</code> or{" "}
            <code className="api-inline">X-Api-Key</code> also works — do not omit the key, and
            do not send a workspace Google token. Keys start with{" "}
            <code className="api-inline">fw_live_</code> and do not expire. GET catalog works
            without a key. POST convert bills page credits on your API plan, separate from the
            workspace role.
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
                Signed in as {me.user.email} · workspace {me.plan} · API {me.api_plan || "api_free"}
                {keyHint !== "YOUR_API_KEY" ? ` · ${keyHint}` : ""}. Treat keys like passwords.
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
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Examples</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Replace YOUR_API_KEY, then POST a real file. Default JSON embeds Markdown in{" "}
            <code className="api-inline">markdown</code> (and the export in{" "}
            <code className="api-inline">content</code>). Use{" "}
            <code className="api-inline">download=true</code> to save the file, or pipe JSON
            through <code className="api-inline">jq</code>.
          </p>
          <CodeBlock lang="bash" label="save file" code={examples.curlFile} />
          <CodeBlock lang="bash" label="print markdown" code={examples.curlJson} />
          <CodeBlock lang="python" code={examples.python} />
          <CodeBlock lang="javascript" code={examples.js} />
        </section>

        <section className="panel overflow-x-auto rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Endpoints</h2>
          <table className="mt-4 w-full min-w-[520px] border-collapse text-left text-sm">
            <caption className="sr-only">Convert API endpoints</caption>
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                <th className="pb-2 pr-3 font-medium">Method</th>
                <th className="pb-2 pr-3 font-medium">Path</th>
                <th className="pb-2 font-medium">What it does</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[var(--line)]">
                <td className="py-2.5 pr-3 font-medium">GET</td>
                <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)] text-[13px] text-[var(--accent-strong)]">
                  /api/health
                </td>
                <td className="py-2.5 text-[var(--ink-muted)]">Liveness and engine status</td>
              </tr>
              <tr className="border-t border-[var(--line)]">
                <td className="py-2.5 pr-3 font-medium">GET</td>
                <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)] text-[13px] text-[var(--accent-strong)]">
                  /api/v1/convert
                </td>
                <td className="py-2.5 text-[var(--ink-muted)]">Inputs, targets, options, capabilities</td>
              </tr>
              <tr className="border-t border-[var(--line)]">
                <td className="py-2.5 pr-3 font-medium">POST</td>
                <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)] text-[13px] text-[var(--accent-strong)]">
                  /api/v1/convert
                </td>
                <td className="py-2.5 text-[var(--ink-muted)]">
                  Multipart <code className="api-inline">file</code> + options. No{" "}
                  <code className="api-inline">s3_key</code>
                </td>
              </tr>
              <tr className="border-t border-[var(--line)]">
                <td className="py-2.5 pr-3 font-medium">GET</td>
                <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)] text-[13px] text-[var(--accent-strong)]">
                  /api/templates/starters
                </td>
                <td className="py-2.5 text-[var(--ink-muted)]">
                  Built-in Design starter catalog with categories and variable schemas (JWT or API key)
                </td>
              </tr>
              <tr className="border-t border-[var(--line)]">
                <td className="py-2.5 pr-3 font-medium">GET</td>
                <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)] text-[13px] text-[var(--accent-strong)]">
                  /api/templates/starters/{"{id}"}
                </td>
                <td className="py-2.5 text-[var(--ink-muted)]">
                  Full starter DesignDocument + params (e.g. <code className="api-inline">family_daily</code>)
                </td>
              </tr>
              <tr className="border-t border-[var(--line)]">
                <td className="py-2.5 pr-3 font-medium">POST</td>
                <td className="py-2.5 pr-3 font-[family-name:var(--font-mono)] text-[13px] text-[var(--accent-strong)]">
                  /api/templates/starters/{"{id}"}/render
                </td>
                <td className="py-2.5 text-[var(--ink-muted)]">
                  Fill with <code className="api-inline">variables</code> / <code className="api-inline">context</code>{" "}
                  (or AI fill from <code className="api-inline">markdown</code>); returns HTML, Markdown, or DOCX
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-4 text-sm leading-6 text-[var(--ink-muted)]">
            Useful form fields: <code className="api-inline">target</code> (
            <code className="api-inline">markdown</code>, <code className="api-inline">txt</code>,{" "}
            <code className="api-inline">html</code>, <code className="api-inline">json</code>,{" "}
            <code className="api-inline">docx</code>),{" "}
            <code className="api-inline">download=true</code> to get the file,{" "}
            <code className="api-inline">use_ai=true</code> for scans,{" "}
            <code className="api-inline">target_lang=en</code> to translate. Max upload is 50 MB.
          </p>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
            Design starters include family schedules, invoices, meeting agendas, project plans, task
            lists, and timesheets. Pass explicit <code className="api-inline">variables</code> with{" "}
            <code className="api-inline">fill=none</code>, use sample defaults with{" "}
            <code className="api-inline">fill=defaults</code>, or AI-fill from source markdown with{" "}
            <code className="api-inline">fill=auto</code>. Browse starters in the{" "}
            <a href="/templates" className="text-[var(--accent-strong)] underline-offset-2 hover:underline">
              Design library
            </a>
            .
          </p>
        </section>

        <section className="panel rounded-3xl px-5 py-5">
          <h2 className="font-[family-name:var(--font-display)] text-2xl tracking-tight">Quota</h2>
          <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">
            Convert API uses page credits on a separate API plan. Standard convert is 1 credit per
            page. AI reading or translation is 3 credits per page. API Free includes 100 credits /
            month. Paid API plans start at $19 / month for 2,000 credits and can be combined with
            workspace Pro or Premium. Workspace file quotas do not apply here.{" "}
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
