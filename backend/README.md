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
- Extract (workspace): `POST /api/extract` (`file` or `s3_key`, `output_format`)
- One-shot convert: `GET /api/v1/convert` (options check), `POST /api/v1/convert` (`file` + `target`; no `s3_key`)

Option reference (inputs, targets, form fields, languages, errors): [docs/convert-api.md](../docs/convert-api.md)
