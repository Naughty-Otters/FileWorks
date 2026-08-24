# Post-deploy integration tests

Standalone Playwright suite for **UI page loads**, **workspace option coverage**, and **Convert API** param matrices. Run it **after** a staging/prod deploy (or against local Compose) — separate from unit coverage in `backend/` and `frontend/`.

## Quick start via `fw` (recommended)

Pick the environment with `--env`, then run tests (same URLs the deploy stack uses):

```bash
./scripts/fw --env staging test-all
./scripts/fw --env staging test-smoke
./scripts/fw --env staging test --mode all
./scripts/fw --env staging test-api
./scripts/fw --env local test-ui
./scripts/fw --env prod test-smoke --yes
```

Interactive: `./scripts/fw` → choose environment → **Test** layer → **All tests** / smoke / API / UI / convert.

| `fw --env` | UI | API |
|------------|----|-----|
| `local` | http://localhost:3000 | http://localhost:8000 |
| `dev` | https://fileworks-dev.pages.dev | Terraform / `FW_API_URL` |
| `staging` | https://staging.fileworks.ai | https://api.staging.fileworks.ai |
| `prod` | https://fileworks.ai | https://api.fileworks.ai |

Convert POST tests need `FW_API_KEY` (export it, or put it in `integration/.env` / `integration/.env.<env>`).

## Quick start (standalone)

```bash
cd integration
cp .env.example .env
# Edit .env — set FW_API_KEY=fw_live_… from Profile on staging

npm install
npx playwright install chromium

# Smoke only (no API key needed for most checks)
./scripts/run.sh staging smoke

# Full suite (UI + API; convert matrix needs FW_API_KEY)
./scripts/run.sh staging

# API or UI alone
./scripts/run.sh staging api
./scripts/run.sh staging ui
```

Local Compose:

```bash
./scripts/run.sh local smoke
FW_API_KEY=fw_live_… ./scripts/run.sh local convert
```

Prod (use carefully — burns real credits):

```bash
./scripts/run.sh prod smoke
```

## Environments

| `FW_ENV` | UI (`FW_BASE_URL`) | API (`FW_API_URL`) |
|----------|--------------------|--------------------|
| `local` | http://localhost:3000 | http://localhost:8000 |
| `dev` | https://fileworks-dev.pages.dev | set `FW_API_URL` / Terraform |
| `staging` (default) | https://staging.fileworks.ai | https://api.staging.fileworks.ai |
| `prod` | https://fileworks.ai | https://api.fileworks.ai |

Override URLs with `FW_BASE_URL` / `FW_API_URL`. Load secrets from `.env`, `.env.local`, or `.env.<env>`.

| Variable | Purpose |
|----------|---------|
| `FW_API_KEY` | `fw_live_…` for `POST /api/v1/convert` (Profile → API keys) |
| `FW_STORAGE_STATE` | Playwright storage JSON for **signed-in** workspace convert UI tests |
| `FW_CONVERT_TIMEOUT_MS` | Convert wait (default `180000`) for cold Lambdas |

## Test map

### Tags

| Tag | Meaning |
|-----|---------|
| `@smoke` | Fast post-deploy gate: pages + health + catalog |
| `@convert` | Real conversions (API key and/or signed-in UI) |

### UI (`--project=ui`)

| Spec | What it covers |
|------|----------------|
| `ui/pages.spec.ts` | Every public route loads; header nav |
| `ui/workspace-options.spec.ts` | File upload, Options panel toggles, Produce-as dialog, guest Convert gate |
| `ui/workspace-convert.spec.ts` | Signed-in extract → Markdown (needs `FW_STORAGE_STATE`) |

### API (`--project=api`)

| Spec | What it covers |
|------|----------------|
| `api/health.spec.ts` | `/api/health`, `/api/engines`, `/api/options` |
| `api/convert-catalog.spec.ts` | `GET /api/v1/convert` guest + keyed catalog, option keys, targets |
| `api/convert-targets.spec.ts` | Auth rejection, empty/unsupported file, `target=` matrix, `download=true`, txt/md/pdf/png inputs |
| `api/convert-options.spec.ts` | Parse-option matrix (`prefer_structure`, OCR, tables, …), `use_ai` vs catalog, boolean coercion, design fill |

### Option / param coverage (API)

Exercised against `sample.txt` (cheap) unless noted:

- **Targets:** `markdown`, `txt`, `html`, `json`, `docx` (+ `download=true`)
- **Inputs:** `.txt`, `.md`, `.pdf`, `.png`
- **Parse flags:** defaults, `prefer_structure`, `preserve_images`, `ocr_high_quality`, `use_doc_preprocessor`, table/formula/seal/chart recognition, `use_region_detection`, `format_block_content`
- **AI / design:** `use_ai` (skipped soft-fail if catalog says unavailable), `design=invoice` + `design_fill=defaults`
- **Auth / errors:** missing key → 401/403; empty file → 400; bad extension → 400

## Signed-in workspace UI convert

Google OAuth cannot be automated reliably in CI. Capture a storage state once:

```bash
cd integration
npx playwright codegen --save-storage=.auth/user.json https://staging.fileworks.ai
# Sign in via Google in the browser window, then close.
echo 'FW_STORAGE_STATE=.auth/user.json' >> .env
./scripts/run.sh staging --  # or: npm run test -- --grep @convert --project=ui
```

Do **not** commit `.auth/` or `.env`.

## npm scripts

```bash
npm run test:smoke      # @smoke
npm run test:api
npm run test:ui
npm run test:staging    # FW_ENV=staging full
npm run test:local
npm run report          # open last HTML report
```

## After deploy checklist

1. Deploy API + frontend to staging.
2. `./scripts/run.sh staging smoke` — pages + health must pass.
3. Ensure a staging API key with credits exists; set `FW_API_KEY`.
4. `./scripts/run.sh staging convert` — full convert matrix.
5. Optionally refresh `FW_STORAGE_STATE` and run UI `@convert`.

## Layout

```
integration/
├── api/                 # HTTP / Convert API specs
├── ui/                  # Browser specs
├── fixtures/            # sample.txt|md|pdf|png
├── helpers/             # env, API client, fixture constants
├── scripts/run.sh       # env + mode wrapper
├── playwright.config.ts
└── .env.example
```
