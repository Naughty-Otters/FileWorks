# FileWorks API

FastAPI service for FileWorks — convert and transform files into Markdown and other formats.

```bash
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Auth tables live in Postgres. Set `DATABASE_URL` and apply migrations (also runs automatically when the API starts):

```bash
./scripts/fw db-upgrade

# After changing app/db/models.py:
./scripts/fw db-revision
./scripts/fw db-upgrade
```

- Docs: http://127.0.0.1:8000/docs
- Health: `GET /api/health`
- Warmup: `POST /api/warmup`
- Extract: `POST /api/extract` (`file`, `output_format`)
