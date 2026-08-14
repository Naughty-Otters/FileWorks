# LLM provider secrets

FileWorks can use a **vision LLM** as a reading engine (images and PDFs → Markdown).
Each vendor uses its **official LangChain package** (`ChatDeepSeek`, `ChatOpenAI`, …).
See `app/engines/llm/providers/`.

Readers still run **AnyDoc → LLM (if configured) → OCR**. If the LLM call fails or
returns empty Markdown, the pipeline falls through to Paddle OCR.

Do not commit real keys. Inject them from your secret manager at deploy time.

## Choose a provider

```
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o          # optional; each provider has a default
LLM_PRIORITY=30           # after AnyDoc (10), before OCR (50); raise to demote
LLM_MAX_PAGES=8
LLM_TIMEOUT_S=120
```

`LLM_PROVIDER` values: `openrouter` | `fireworks` | `deepseek` | `kimi` | `glm` | `openai` | `grok` | `claude`

Aliases: `kimi3` → kimi, `moonshot` → kimi, `glok` / `xai` → grok, `anthropic` → claude, `zhipu` → glm.

Optional: `LLM_API_KEY` overrides the provider-specific key.

## Translation post-process

After Markdown is produced, an optional **text LLM** can translate it. This uses
**separate** env vars from the vision reader — hosted DeepSeek is valid here.

```
TRANSLATE_PROVIDER=deepseek
TRANSLATE_MODEL=deepseek-v4-flash    # optional; default is deepseek-chat
TRANSLATE_API_KEY=                   # DeepSeek key only — not LLM_API_KEY / OpenAI sk-svcacct
TRANSLATE_BASE_URL=                  # optional
```

`TRANSLATE_PROVIDER` uses the same catalog as `LLM_PROVIDER`. Default UI language is
**Original (no translation)** — the post-process is skipped.

## API endpoint

The LangChain client posts to `{base_url}/chat/completions` (Claude uses its own Messages URL). Set one of:

| Env var | Meaning |
| --- | --- |
| `LLM_ENDPOINT` | Full URL. If it ends with `/chat/completions`, that suffix is stripped. |
| `LLM_BASE_URL` | API root, e.g. `http://127.0.0.1:8000/v1` |
| `{PROVIDER}_BASE_URL` | Same as `LLM_BASE_URL` for one vendor, e.g. `DEEPSEEK_BASE_URL` |

Priority: `LLM_ENDPOINT` → `LLM_BASE_URL` → `{provider}_base_url` → catalog default.

**DeepSeek:** hosted `api.deepseek.com` is **text-only**. No hosted DeepSeek model accepts `image_url` / files. File reading needs a vision model:

| Provider | Default vision model |
| --- | --- |
| OpenAI | `gpt-4o` |
| Claude | `claude-sonnet-4-5` (native PDF) |
| GLM | `glm-4.5v` |
| OpenRouter | `openai/gpt-4o-mini` |
| Fireworks | Llama vision instruct |
| Grok | `grok-2-vision-1212` |
| Kimi | `kimi-k2.5` |

To keep DeepSeek, point at a self-hosted vision/OCR server:

```
LLM_PROVIDER=deepseek
DEEPSEEK_BASE_URL=http://127.0.0.1:8000/v1
LLM_MODEL=deepseek-ocr
```

## Per-provider keys

Set **only the provider you use**. Unused variables can stay unset.

| Provider | Package | Files / images | Env var(s) | Default model |
| --- | --- | --- | --- | --- |
| OpenRouter | `langchain-openrouter` | yes | `OPENROUTER_API_KEY` | `openai/gpt-4o-mini` |
| Fireworks | `langchain-fireworks` | yes | `FIREWORKS_API_KEY` | `accounts/fireworks/models/llama-v3p2-11b-vision-instruct` |
| DeepSeek | `langchain-deepseek` | hosted no (custom OCR host yes) | `DEEPSEEK_API_KEY` | `deepseek-chat` |
| Kimi | `langchain-moonshot` | yes | `KIMI_API_KEY` or `MOONSHOT_API_KEY` | `kimi-k2.5` |
| GLM | `langchain-openai` (OpenAI-compatible; no partner pkg) | yes | `GLM_API_KEY` or `ZHIPU_API_KEY` | `glm-4.5v` |
| OpenAI | `langchain-openai` | yes | `OPENAI_API_KEY` | `gpt-4o` |
| Grok | `langchain-xai` | yes | `GROK_API_KEY` or `XAI_API_KEY` | `grok-2-vision-1212` |
| Claude | `langchain-anthropic` | yes (native PDF) | `ANTHROPIC_API_KEY` or `CLAUDE_API_KEY` | `claude-sonnet-4-5` |

Example (OpenAI):

```
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

Example (Claude):

```
LLM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...
LLM_MODEL=claude-sonnet-4-5
```

Example (OpenRouter, pick any routed model):

```
LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...
LLM_MODEL=google/gemini-2.5-flash
```

`GET /api/health` lists the `llm` reader with `"configured": true` when the selected key is present.
