# FileWorks

**Convert. Transform. Any format.**

Turn office docs, PDFs, images, spreadsheets, and more into editable Markdown — then download as Markdown, TXT, HTML, JSON, or PDF.

```
fileworks/
├── backend/    FastAPI conversion API (uv)
└── frontend/   Next.js split-pane workspace (light/dark)
```

## Features

- Drag-and-drop upload for images, PDFs, and office docs (Word / Excel / PowerPoint / ODT / CSV / …)
- **AnyDoc** conversion to clean Markdown (via `firecrawl-anydoc`)
- Automatic fallback for scans and images (layout + text recognition when a file has no text layer)
- Editable Markdown preview on the right; download as Markdown / TXT / HTML / JSON / PDF (print)
- Light / dark theme toggle
- Google sign-in with plans: **Guest** (browse only), **Basic** (1 file/day with AI + translation), **Pro** (500/month, 100 with AI or translation), **Premium** (1000/month, 500 with AI or translation)
- Reading order: **AnyDoc** → **LLM** (if configured) → **OCR** (PP-OCR, then PP-StructureV3)

## Prerequisites

- Python 3.11+ (3.12 recommended)
- Node.js 20+
- [uv](https://docs.astral.sh/uv/)

## Tests and coverage

Pre-commit runs the suites with coverage floors (backend **80%**, frontend Vitest thresholds in `frontend/vitest.config.ts`). A commit that touches `backend/` or `frontend/` fails if tests fail or coverage drops.

```bash
uvx pre-commit install
```

Manual:

```bash
./scripts/check-coverage.sh --all
# or:
cd backend && PYTHONPATH=. uv run pytest --cov=app --cov-fail-under=80
cd frontend && npm run test:coverage
```

## Operator CLI

Rich TUI (same pattern as OpenFDEServer `python -m deploy`):

```bash
./scripts/fw                         # interactive menu
./scripts/fw compose-up              # Postgres + API + UI
./scripts/fw db-upgrade              # Alembic migrations
./scripts/fw --env dev full          # AWS Lambda + Cloudflare Pages
```

## Local stack (Docker Compose)

Postgres + API + Next.js:

```bash
./scripts/fw compose-up
# optional: GOOGLE_CLIENT_ID=.... JWT_SECRET=....
```

- UI: http://localhost:3000
- API: http://localhost:8000
- Postgres: `postgresql://fileworks:fileworks@127.0.0.1:5432/fileworks`

Schema migrations run when the API starts. To apply them yourself:

```bash
./scripts/fw db-upgrade
```

Without Compose, run the API and UI separately as below. Auth (Google sign-in, plans, quotas) needs `DATABASE_URL` pointing at Postgres.

Create a Google OAuth **Web** client and add authorized JavaScript origins `http://localhost:3000` (and later `https://fileworks-<env>.pages.dev`). Set `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID`.

## Backend

```bash
cd backend
uv sync
# Document conversion (AnyDoc) + HTML export extras are in main deps:
#   firecrawl-anydoc, markdown
# paddlepaddle is pulled from the official paddle CPU index (see pyproject.toml).

uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API:

- `GET /api/health` — service status + registered engines / option support
- `GET /api/engines` — list OCR provider strategies (Paddle Structure / PP-OCR)
- `POST /api/warmup` — eagerly load the configured OCR provider
- `POST /api/extract` — multipart form: `file`, optional `output_format`, parse option toggles (AnyDoc → LLM → OCR)
- `POST /api/export` — JSON body `{ markdown, format, filename? }` → downloadable `markdown|txt|html|json`

Docs: http://127.0.0.1:8000/docs

Optional env (backend `.env`):

```
PADDLE_DEVICE=cpu
OCR_ENGINE=ocr
MAX_UPLOAD_MB=50
```

`OCR_ENGINE` (`structure` | `ocr`) controls which Paddle provider is warmed by `/api/warmup`. Uploads try readers in order: AnyDoc → LLM (if `LLM_PROVIDER` + API key) → OCR.

LLM providers (OpenRouter, Fireworks, DeepSeek, Kimi, GLM, OpenAI, Grok, Claude) use **LangChain** (`ChatOpenAI` / `ChatAnthropic`) with per-provider secrets — see [backend/secrets/README.md](backend/secrets/README.md).

Document processing (readers + decision + export) is modular OO — see [backend/app/processing/ARCHITECTURE.md](backend/app/processing/ARCHITECTURE.md).

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000

The Next.js app proxies `/api/*` to `http://127.0.0.1:8000` (override with `NEXT_PUBLIC_API_URL`).

## AWS + Cloudflare deploy

API on Lambda, UI on Cloudflare Pages, per environment (`dev` / `staging` / `prod`):

```bash
./scripts/fw
```

See [infra/README.md](infra/README.md).


## Typical workflow

1. Start the API on port 8000
2. Start the UI on port 3000
3. Drop an image/PDF on the left
4. Click **Convert**
5. Toggle Markdown / JSON on the right and copy or download as needed

The first convert of a scanned file may download recognition models and take a few minutes.

## Document history

Successful conversions are stored for later recall:

- Local layout (default): `backend/data/history/docs/{id}/`
  - `source.*` — original upload
  - `meta.json` — filename, engine, timestamps
  - `result.json` — markdown + JSON payload
- Switch later with `STORAGE_BACKEND=s3` (scaffold in `app/storage/s3.py`)

API:

- `GET /api/history` — list past documents
- `GET /api/history/{id}` — restore metadata + converted content
- `GET /api/history/{id}/file` — original file bytes
- `DELETE /api/history/{id}` — remove an entry
