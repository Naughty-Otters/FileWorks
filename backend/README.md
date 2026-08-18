# FileWorks API

FastAPI service for FileWorks — convert and transform files into Markdown and other formats.

```bash
uv sync --all-extras
uv run python -m app
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

LiteParse OCR callbacks (internal, not client-facing): [docs/ocr-callback-api.md](../docs/ocr-callback-api.md) — `POST /api/ocr/fast`, `/api/ocr/deep`, `/api/ocr`.

## Logs

Start with `python -m app` (not bare `uvicorn`) so `app.*` INFO reaches stderr —
that entrypoint hands uvicorn the config from `app/core/logsetup.py`. Each convert
logs the reader it tried and one summary line:

```
INFO:     Trying reader=anydoc (priority=10, confidence=0.90, ...)
INFO:     Using engine=anydoc provider=anydoc file=policy.pdf pages=21 format=pdf prefer_structure=false
```

Anything calling `logging.config.fileConfig`/`dictConfig` must pass
`disable_existing_loggers=False`, or it silences every `app.*` logger.
Set `UVICORN_RELOAD=1` for auto-reload; note reload can hide worker logs.
